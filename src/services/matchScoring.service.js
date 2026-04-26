import openai from '../config/openai.js';
import { cosineSimilarity } from '../utils/cosineSimilarity.util.js';
import { normalizeSkills } from '../utils/scoring.util.js';
import { safeParseJson } from '../utils/llmJson.util.js';

const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'];
const WEIGHTS = { skills: 0.35, seniority: 0.20, experience: 0.20, domain: 0.15, preferred: 0.10 };

export async function scoreCandidate(candidate, jd) {
    // --- Deterministic sub-scores (no LLM) ---
    const skillsCoverage = computeSkillsCoverage(candidate.skills, jd.requiredSkills);
    const seniorityAlign = computeSeniorityAlignment(candidate.seniorityLevel, jd.seniorityLevel);
    const experienceDepth = computeExperienceDepth(candidate.yearsExperience, jd.yearsExperienceMin);
    const domainRelevance = cosineSimilarity(candidate.profileEmbedding, jd.jdContextEmbedding);
    const preferredBonus = computePreferredBonus(candidate.skills, jd.preferredSkills);

    const matchScore = (
        WEIGHTS.skills * skillsCoverage +
        WEIGHTS.seniority * seniorityAlign +
        WEIGHTS.experience * experienceDepth +
        WEIGHTS.domain * domainRelevance +
        WEIGHTS.preferred * preferredBonus
    ) * 100;

    // --- LLM explainability (only for viable candidates) ---
    if (matchScore < 40) {
        return {
            matchScore, skillsCoverage, seniorityAlign, experienceDepth,
            domainRelevance, preferredBonus, suppressed: false,
            matchExplanation: 'Score below threshold — explanation skipped.',
            topStrengths: [], skillGaps: [], dealBreakerFlags: []
        };
    }

    const explanation = crossValidateExplanation(
        await generateExplanation(candidate, jd),
        candidate.skills,
        jd.requiredSkills,
        jd.preferredSkills
    );

    // Deal-breaker gate
    const suppressed = explanation.deal_breaker_flags.length > 0;
    if (suppressed) {
        console.warn(`[Match Scoring] Candidate ${candidate._id} suppressed due to deal-breakers: ${explanation.deal_breaker_flags.join(', ')}`);
    }

    return {
        matchScore: suppressed ? 0 : matchScore,
        skillsCoverage, seniorityAlign, experienceDepth, domainRelevance, preferredBonus,
        matchExplanation: explanation.match_explanation,
        topStrengths: explanation.top_strengths,
        skillGaps: explanation.skill_gaps,
        dealBreakerFlags: explanation.deal_breaker_flags,
        suppressed,
    };
}

async function generateExplanation(candidate, jd) {
    const shouldFallback = (err) => {
        if (!err) return false;
        if (err.code === 'json_validate_failed') return true;
        if (typeof err.message === 'string' && /json|parse|schema/i.test(err.message)) return true;
        return false;
    };

    const payload = {
        jd_required_skills: jd.requiredSkills,
        jd_seniority: jd.seniorityLevel,
        jd_domain: jd.domain,
        jd_deal_breakers: jd.dealBreakers,
        candidate_skills: candidate.skills,
        candidate_seniority: candidate.seniorityLevel,
        candidate_years: candidate.yearsExperience,
    };
    const systemPrompt = `You are a senior technical recruiter. Write a concise 2-3 sentence match explanation.
Be specific using exact skills and gaps from input only.
Only flag deal breakers if explicitly missing in candidate skills.
Output valid JSON only.`;

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0.1,
            max_tokens: 350,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'match_explanation',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            match_explanation: { type: 'string' },
                            top_strengths: { type: 'array', items: { type: 'string' }, maxItems: 3 },
                            skill_gaps: { type: 'array', items: { type: 'string' }, maxItems: 3 },
                            deal_breaker_flags: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['match_explanation', 'top_strengths', 'skill_gaps', 'deal_breaker_flags'],
                        additionalProperties: false,
                    },
                },
            },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        });
        return normalizeExplanation(safeParseJson(response.choices[0].message.content));
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn('[Match Scoring] Strict JSON failed. Retrying with json_object.');
    }

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0.1,
            max_tokens: 350,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `${JSON.stringify(payload)}

Return ONLY JSON with keys:
match_explanation, top_strengths, skill_gaps, deal_breaker_flags.
Use [] for unknown arrays.`,
                },
            ],
        });
        return normalizeExplanation(safeParseJson(response.choices[0].message.content));
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn('[Match Scoring] json_object fallback failed. Using local explanation.');
        return localExplanation(payload);
    }
}

// --- Pure scoring utilities ---

function computeSkillsCoverage(candidateSkills, requiredSkills) {
    if (!requiredSkills.length) return 0.8;
    const cNorm = new Set(normalizeSkills(candidateSkills));
    const rNorm = normalizeSkills(requiredSkills);
    return rNorm.filter(s => cNorm.has(s)).length / rNorm.length;
}

function computeSeniorityAlignment(candidateLevel, jdLevel) {
    const diff = Math.abs(
        SENIORITY_LEVELS.indexOf(candidateLevel) - SENIORITY_LEVELS.indexOf(jdLevel)
    );
    return [1.0, 0.6, 0.2, 0.0][Math.min(diff, 3)];
}

function computeExperienceDepth(candidateYears, jdMin) {
    if (!jdMin) return 0.8;
    if (candidateYears >= jdMin) return Math.min(1.0, 0.7 + 0.06 * (candidateYears - jdMin));
    return Math.max(0.0, 0.7 - 0.15 * (jdMin - candidateYears));
}

function computePreferredBonus(candidateSkills, preferredSkills) {
    if (!preferredSkills.length) return 0;
    const cNorm = new Set(normalizeSkills(candidateSkills));
    const pNorm = normalizeSkills(preferredSkills);
    return pNorm.filter(s => cNorm.has(s)).length / pNorm.length;
}

function normalizeExplanation(expl) {
    return {
        match_explanation: typeof expl?.match_explanation === 'string'
            ? expl.match_explanation.trim()
            : 'Candidate has partial alignment with the role requirements.',
        top_strengths: asStringArray(expl?.top_strengths).slice(0, 3),
        skill_gaps: asStringArray(expl?.skill_gaps).slice(0, 3),
        deal_breaker_flags: asStringArray(expl?.deal_breaker_flags),
    };
}

function localExplanation(payload) {
    const req = new Set(normalizeSkills(payload.jd_required_skills ?? []));
    const cand = new Set(normalizeSkills(payload.candidate_skills ?? []));
    const overlaps = [...req].filter((s) => cand.has(s));
    const gaps = [...req].filter((s) => !cand.has(s)).slice(0, 3);
    const strengths = overlaps.slice(0, 3);
    const missingDealBreakers = normalizeSkills(payload.jd_deal_breakers ?? [])
        .filter((d) => !cand.has(d))
        .slice(0, 3);

    const explanation = strengths.length
        ? `Candidate aligns on ${strengths.join(', ')} and has relevant background for ${payload.jd_domain}.`
        : `Candidate shows limited direct overlap with required skills for ${payload.jd_domain}.`;

    return {
        match_explanation: explanation,
        top_strengths: strengths,
        skill_gaps: gaps,
        deal_breaker_flags: missingDealBreakers,
    };
}

function asStringArray(v) {
    if (!Array.isArray(v)) return [];
    return v
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean);
}

function crossValidateExplanation(expl, candidateSkills, requiredSkills, preferredSkills) {
    const candidateSkillSet = new Set(normalizeSkills(candidateSkills ?? []));
    const requiredSkillSet = new Set(normalizeSkills(requiredSkills ?? []));
    const preferredSkillSet = new Set(normalizeSkills(preferredSkills ?? []));
    const jdSkillSet = new Set([...requiredSkillSet, ...preferredSkillSet]);
    return {
        ...expl,
        top_strengths: normalizeSkills(expl.top_strengths)
            .filter((skill) => candidateSkillSet.has(skill))
            .slice(0, 3),
        skill_gaps: normalizeSkills(expl.skill_gaps)
            .filter((skill) => requiredSkillSet.has(skill) || jdSkillSet.has(skill))
            .slice(0, 3),
        deal_breaker_flags: normalizeSkills(expl.deal_breaker_flags).slice(0, 5),
    };
}