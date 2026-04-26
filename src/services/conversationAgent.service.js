import openai from '../config/openai.js';
import { safeParseJson } from '../utils/llmJson.util.js';

const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

const INTEREST_WEIGHTS = {
    interest: 0.30, motivation: 0.25, availability: 0.20,
    engagement: 0.15, concern: 0.10,
};

export async function runConversation(candidate, jd, matchResult) {
    const questions = await generateQuestionPlan(candidate, jd, matchResult);
    const transcript = [];
    const signals = [];

    for (let turn = 0; turn < Math.min(questions.length, 8); turn++) {
        const recruiterMsg = await generateRecruiterTurn(questions[turn], transcript, jd);
        transcript.push({ role: 'recruiter', content: recruiterMsg });

        const candidateResponse = await generateCandidateTurn(recruiterMsg, candidate, transcript);
        transcript.push({
            role: 'candidate',
            content: candidateResponse.message,
            signalAnnotation: candidateResponse.signal,
        });
        signals.push(candidateResponse.signal);

        if (
            candidateResponse.signal.signalType === 'negative' &&
            candidateResponse.signal.confidence > 0.85
        ) break;
    }

    const { interestScore, dimensionScores } = computeInterestScore(signals);
    const signalReliability = detectSignalReliability(signals);
    const summary = await generateInterestSummary(transcript, candidate);

    return {
        interestScore,
        interestDimensionScores: dimensionScores,
        signalReliability,
        conversationTranscript: transcript,
        interestSummary: summary.interest_summary,
        availabilityFlag: summary.availability_flag ?? 'unclear',
        concernFlags: summary.concern_flags ?? [],
        recommendedNextAction: summary.recommended_next_action,
    };
}

async function generateQuestionPlan(candidate, jd, matchResult) {
    const payload = {
        role: jd.jobTitle,
        domain: jd.domain,
        candidate_headline: candidate.headline,
        candidate_years: candidate.yearsExperience,
        top_gap: matchResult.skillGaps?.[0] ?? 'none identified',
        top_strength: matchResult.topStrengths?.[0] ?? '',
    };
    const system = `Generate a 4-8 question recruiter outreach plan.
Order: warm opener, availability check, motivation alignment, skill-gap probe, next-step openness.
Tone: professional and conversational.
Return JSON only.`;
    const parsed = await requestStructuredJson({
        schemaName: 'question_plan',
        schema: {
            type: 'object',
            properties: { questions: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 8 } },
            required: ['questions'],
            additionalProperties: false,
        },
        system,
        payload,
        fallbackPrompt: `Return ONLY JSON with key "questions" as an array of 4-8 strings.`,
        temperature: 0.3,
        localFallback: () => ({
            questions: [
                `Hi ${candidate.name}, I liked your background in ${candidate.headline ?? 'this domain'}. What type of role are you targeting now?`,
                'Are you actively interviewing right now, and what is your notice period?',
                `What motivates you most about this ${jd.jobTitle} opportunity?`,
                `One focus area is ${matchResult.skillGaps?.[0] ?? 'a role-specific skill'}. How comfortable are you with that today?`,
                'If alignment looks good, would you be open to a short intro call this week?',
                'Are there constraints that might affect timeline or role fit?',
                'What would make you say yes to the right opportunity?',
                'Would you like me to share interview process details next?',
            ],
        }),
    });
    return normalizeQuestionPlan(parsed).questions;
}

/**
 * Generates the recruiter's message for a given turn.
 * Uses prior transcript context to adapt naturally.
 * @param {string} plannedQuestion - Question from the plan
 * @param {Array}  transcript - Prior turns
 * @param {object} jd - Structured JD
 * @returns {Promise<string>} Recruiter message
 */
async function generateRecruiterTurn(plannedQuestion, transcript, jd) {
    if (transcript.length === 0) {
        // First message: always use the planned opener verbatim
        return plannedQuestion;
    }

    const response = await openai.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.4,
        max_tokens: 200,
        messages: [
            {
                role: 'system',
                content: `You are a professional recruiter continuing an outreach conversation.
          Role you're hiring for: ${jd.jobTitle} (${jd.domain}).
          Respond naturally to the candidate's last message.
          Then pivot to the next planned question: "${plannedQuestion}"
          Keep your response to 2–3 sentences. Do not oversell the role.
          Output ONLY the recruiter message text — no quotes, no labels.`,
            },
            ...transcript.map(t => ({
                role: t.role === 'recruiter' ? 'assistant' : 'user',
                content: t.content,
            })),
        ],
    });
    return response.choices[0].message.content.trim();
}

async function generateCandidateTurn(recruiterMessage, candidate, transcript) {
    const payload = {
        recruiterMessage,
        candidate: {
            summary: candidate.summary ?? 'Experienced professional',
            availability: candidate.availabilitySignal,
            skills: candidate.skills?.slice(0, 8) ?? [],
            yearsExperience: candidate.yearsExperience,
        },
        transcript: transcript.slice(-6).map(t => `${t.role}: ${t.content}`),
    };
    const system = `Simulate a realistic job candidate response in 2-4 sentences.
Return JSON only with keys: message, signal.
signal must include signalType, signalCategory, confidence (0..1).`;
    const parsed = await requestStructuredJson({
        schemaName: 'candidate_turn',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string' },
                signal: {
                    type: 'object',
                    properties: {
                        signalType: { type: 'string', enum: ['positive', 'negative', 'neutral', 'ambiguous'] },
                        signalCategory: { type: 'string', enum: ['interest', 'availability', 'motivation', 'concern', 'engagement'] },
                        confidence: { type: 'number' },
                    },
                    required: ['signalType', 'signalCategory', 'confidence'],
                    additionalProperties: false,
                },
            },
            required: ['message', 'signal'],
            additionalProperties: false,
        },
        system,
        payload,
        fallbackPrompt: 'Return ONLY JSON: {"message":"...","signal":{"signalType":"...","signalCategory":"...","confidence":0.5}}',
        temperature: 0.6,
        localFallback: () => ({
            message: `Thanks for reaching out. I am open to hearing more about the role and how it aligns with my background.`,
            signal: {
                signalType: candidate.availabilitySignal === 'actively_looking' ? 'positive' : 'neutral',
                signalCategory: 'interest',
                confidence: candidate.availabilitySignal === 'actively_looking' ? 0.8 : 0.55,
            },
        }),
    });
    return normalizeCandidateTurn(parsed);
}

async function generateInterestSummary(transcript, candidate) {
    const payload = {
        candidate: candidate.name,
        transcript: transcript.map(t => `${t.role.toUpperCase()}: ${t.content}`),
    };
    const system = `Summarize recruiter-candidate outreach with direct, action-oriented language.
Return JSON only with keys:
interest_summary, availability_flag, concern_flags, recommended_next_action.`;
    const parsed = await requestStructuredJson({
        schemaName: 'interest_summary',
        schema: {
            type: 'object',
            properties: {
                interest_summary: { type: 'string' },
                availability_flag: { type: 'string', enum: ['ready_now', '1-month', '2-months', 'unclear'] },
                concern_flags: { type: 'array', items: { type: 'string' } },
                recommended_next_action: { type: 'string' },
            },
            required: ['interest_summary', 'availability_flag', 'concern_flags', 'recommended_next_action'],
            additionalProperties: false,
        },
        system,
        payload,
        fallbackPrompt: 'Return ONLY JSON with the required keys. Use [] for concern_flags.',
        temperature: 0.1,
        localFallback: () => ({
            interest_summary: `${candidate.name} appears moderately interested based on the interaction tone.`,
            availability_flag: 'unclear',
            concern_flags: [],
            recommended_next_action: 'Share role details and ask for a 30-minute introductory call.',
        }),
    });
    return normalizeInterestSummary(parsed);
}

function computeInterestScore(signals) {
    const dimensionScores = {};
    for (const sig of signals) {
        const value =
            sig.signalType === 'positive' ? sig.confidence :
                sig.signalType === 'negative' ? -sig.confidence : 0;
        if (!dimensionScores[sig.signalCategory]) dimensionScores[sig.signalCategory] = [];
        dimensionScores[sig.signalCategory].push(value);
    }
    const raw = Object.entries(INTEREST_WEIGHTS).reduce((sum, [dim, weight]) => {
        const scores = dimensionScores[dim] ?? [];
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return sum + weight * avg;
    }, 0);
    const dimensionAverages = Object.fromEntries(
        Object.entries(INTEREST_WEIGHTS).map(([dim]) => {
            const scores = dimensionScores[dim] ?? [];
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            return [dim, Number((((avg + 1) / 2) * 100).toFixed(2))];
        })
    );
    return {
        interestScore: Math.max(0, Math.min(100, ((raw + 1) / 2) * 100)),
        dimensionScores: dimensionAverages,
    };
}

async function requestStructuredJson({ schemaName, schema, system, payload, fallbackPrompt, localFallback, temperature = 0.2 }) {
    const shouldFallback = (err) => {
        if (!err) return false;
        if (err.code === 'json_validate_failed') return true;
        if (typeof err.message === 'string' && /json|parse|schema/i.test(err.message)) return true;
        return false;
    };

    const parsePayload = (raw) => safeParseJson(raw);

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature,
            max_tokens: 400,
            response_format: {
                type: 'json_schema',
                json_schema: { name: schemaName, strict: true, schema },
            },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        });
        return parsePayload(response.choices[0].message.content);
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn(`[Conversation] ${schemaName} strict JSON failed; trying json_object fallback.`);
    }

    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature,
            max_tokens: 400,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: `${JSON.stringify(payload)}\n\n${fallbackPrompt}` },
            ],
        });
        return parsePayload(response.choices[0].message.content);
    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn(`[Conversation] ${schemaName} json_object fallback failed; using local fallback.`);
        return localFallback();
    }
}

function detectSignalReliability(signals) {
    const byCategory = new Map();
    for (const signal of signals) {
        const list = byCategory.get(signal.signalCategory) ?? [];
        list.push(signal.signalType);
        byCategory.set(signal.signalCategory, list);
    }

    for (const signalTypes of byCategory.values()) {
        if (signalTypes.includes('positive') && signalTypes.includes('negative')) {
            return 'LOW';
        }
    }
    return 'HIGH';
}

function normalizeQuestionPlan(parsed) {
    const questions = Array.isArray(parsed?.questions)
        ? parsed.questions.map((q) => (typeof q === 'string' ? q.trim() : '')).filter(Boolean).slice(0, 8)
        : [];
    return { questions: questions.length ? questions : ['Can you share your current role focus?', 'Are you actively exploring right now?', 'What motivates your next move?', 'Would you be open to a short intro call?'] };
}

function normalizeCandidateTurn(parsed) {
    const signal = parsed?.signal ?? {};
    const allowedType = ['positive', 'negative', 'neutral', 'ambiguous'];
    const allowedCategory = ['interest', 'availability', 'motivation', 'concern', 'engagement'];
    return {
        message: typeof parsed?.message === 'string' && parsed.message.trim()
            ? parsed.message.trim()
            : 'Thanks for the outreach. I am open to discussing this role further.',
        signal: {
            signalType: allowedType.includes(signal.signalType) ? signal.signalType : 'neutral',
            signalCategory: allowedCategory.includes(signal.signalCategory) ? signal.signalCategory : 'interest',
            confidence: Number.isFinite(Number(signal.confidence))
                ? Math.max(0, Math.min(1, Number(signal.confidence)))
                : 0.5,
        },
    };
}

function normalizeInterestSummary(parsed) {
    const allowed = ['ready_now', '1-month', '2-months', 'unclear'];
    return {
        interest_summary: typeof parsed?.interest_summary === 'string' && parsed.interest_summary.trim()
            ? parsed.interest_summary.trim()
            : 'Candidate interest appears moderate based on current conversation.',
        availability_flag: allowed.includes(parsed?.availability_flag) ? parsed.availability_flag : 'unclear',
        concern_flags: Array.isArray(parsed?.concern_flags)
            ? parsed.concern_flags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 5)
            : [],
        recommended_next_action: typeof parsed?.recommended_next_action === 'string' && parsed.recommended_next_action.trim()
            ? parsed.recommended_next_action.trim()
            : 'Send role details and request availability for an intro call.',
    };
}