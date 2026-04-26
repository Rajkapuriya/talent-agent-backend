import openai from '../config/openai.js';
import { safeParseJson } from '../utils/llmJson.util.js';

const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

const TIERS = [
    { name: 'tier1', min: 75, label: 'Priority — schedule immediately' },
    { name: 'tier2', min: 55, label: 'Warm pipeline' },
    { name: 'tier3', min: 35, label: 'Passive pool' },
    { name: 'archive', min: 0, label: 'Archive' },
];

export function computeCombinedScore(matchScore, interestScore) {
    if (!matchScore || !interestScore) return 0;
    const wM = 0.55, wI = 0.45;
    return (wM + wI) / ((wM / matchScore) + (wI / interestScore));
}

export function assignTier(combinedScore) {
    return TIERS.find(t => combinedScore >= t.min)?.name ?? 'archive';
}

export async function generateScoreCard(candidate, matchResult, interestResult, scores) {
    const shouldFallback = (err) => {
        if (!err) return false;
        if (err.code === 'json_validate_failed') return true;
        if (typeof err.message === 'string' && /json|parse|schema/i.test(err.message)) return true;
        return false;
    };

    const payload = {
        name: candidate.name,
        headline: candidate.headline,
        match_score: Math.round(scores.match),
        interest_score: Math.round(scores.interest),
        combined_score: Math.round(scores.combined),
        top_strengths: matchResult.topStrengths,
        skill_gaps: matchResult.skillGaps,
        interest_summary: interestResult.interestSummary,
        next_action: interestResult.recommendedNextAction,
    };
    const systemPrompt = `Write a concise 4-sentence recruiter candidate brief.
Sentence 1: who they are.
Sentence 2: why they match (specific skills).
Sentence 3: interest level and concerns.
Sentence 4: concrete next action.
Return JSON only.`;

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: 260,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'score_card',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: { score_card: { type: 'string' } },
                        required: ['score_card'],
                        additionalProperties: false,
                    },
                },
            },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        });
        return normalizeScoreCard(safeParseJson(response.choices[0].message.content).score_card);
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn('[Ranking] score_card strict JSON failed. Retrying with json_object.');
    }

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: 260,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `${JSON.stringify(payload)}

Return ONLY JSON with one key: score_card.`,
                },
            ],
        });
        return normalizeScoreCard(safeParseJson(response.choices[0].message.content).score_card);
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn('[Ranking] score_card json_object fallback failed. Using local score card.');
        return localScoreCard(payload);
    }
}

export async function generateAggregateInsights(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return {
            commonGap: '',
            jdCalibrationNote: '',
            topRecommendation: null,
        };
    }

    const payload = {
        candidates: entries.slice(0, 12).map((entry) => ({
            name: entry.candidate?.name,
            tier: entry.tier,
            combined_score: Math.round(entry.combinedScore ?? 0),
            top_strength: entry.matchResult?.topStrengths?.[0] ?? '',
            top_gap: entry.matchResult?.skillGaps?.[0] ?? '',
            next_action: entry.interestResult?.recommendedNextAction ?? '',
        })),
    };

    const systemPrompt = `Generate shortlist-level recruiter insights.
Return JSON only with:
common_gap (string),
jd_calibration_note (string),
top_recommendation (object with: name, reason, next_action, confidence_pct).`;

    const localFallback = () => {
        const top = payload.candidates[0] ?? {};
        const commonGap = mostCommon(payload.candidates.map((c) => c.top_gap).filter(Boolean));
        return {
            commonGap: commonGap || 'No dominant gap detected across shortlisted candidates.',
            jdCalibrationNote: commonGap
                ? 'Consider relaxing this recurring gap if interview outcomes remain strong.'
                : '',
            topRecommendation: top.name
                ? {
                    name: top.name,
                    reason: `Highest combined score (${top.combined_score}).`,
                    nextAction: top.next_action || 'Schedule recruiter screen.',
                    confidencePct: Math.max(50, Math.min(95, Math.round(top.combined_score ?? 50))),
                }
                : null,
        };
    };

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: 400,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'aggregate_insights',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            common_gap: { type: 'string' },
                            jd_calibration_note: { type: 'string' },
                            top_recommendation: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    reason: { type: 'string' },
                                    next_action: { type: 'string' },
                                    confidence_pct: { type: 'number' },
                                },
                                required: ['name', 'reason', 'next_action', 'confidence_pct'],
                                additionalProperties: false,
                            },
                        },
                        required: ['common_gap', 'jd_calibration_note', 'top_recommendation'],
                        additionalProperties: false,
                    },
                },
            },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        });
        return normalizeAggregateInsights(safeParseJson(response.choices[0].message.content));
    } catch (err) {
        console.warn('[Ranking] aggregate insights strict JSON failed; using local fallback.', err?.message);
        return localFallback();
    }
}

function normalizeScoreCard(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function localScoreCard(payload) {
    const strengths = Array.isArray(payload.top_strengths) && payload.top_strengths.length
        ? payload.top_strengths.slice(0, 3).join(', ')
        : 'relevant technical capabilities';
    const gaps = Array.isArray(payload.skill_gaps) && payload.skill_gaps.length
        ? payload.skill_gaps.slice(0, 2).join(', ')
        : 'no major blockers identified';
    return `${payload.name} is ${payload.headline ?? 'a relevant candidate'} with a combined score of ${payload.combined_score}. ` +
        `Strong alignment is driven by ${strengths}. ` +
        `Current concerns include ${gaps}; interest summary: ${payload.interest_summary ?? 'moderate interest'}. ` +
        `Recommended next step: ${payload.next_action ?? 'schedule a 30-minute intro call'}.`;
}

function normalizeAggregateInsights(data) {
    return {
        commonGap: typeof data?.common_gap === 'string' ? data.common_gap.trim() : '',
        jdCalibrationNote: typeof data?.jd_calibration_note === 'string' ? data.jd_calibration_note.trim() : '',
        topRecommendation: data?.top_recommendation
            ? {
                name: String(data.top_recommendation.name ?? '').trim(),
                reason: String(data.top_recommendation.reason ?? '').trim(),
                nextAction: String(data.top_recommendation.next_action ?? '').trim(),
                confidencePct: Number.isFinite(Number(data.top_recommendation.confidence_pct))
                    ? Math.max(0, Math.min(100, Number(data.top_recommendation.confidence_pct)))
                    : null,
            }
            : null,
    };
}

function mostCommon(values) {
    const counts = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let best = '';
    let max = 0;
    for (const [value, count] of counts.entries()) {
        if (count > max) {
            best = value;
            max = count;
        }
    }
    return best;
}