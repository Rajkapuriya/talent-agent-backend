// import openai from '../config/openai.js';
// import { getEmbedding } from '../utils/embedding.util.js';

// const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

// // const JD_EXTRACTION_SCHEMA = {
// //     type: 'object',
// //     properties: {
// //         job_title: { type: 'string' },
// //         seniority_level: { type: 'string', enum: ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'] },
// //         domain: { type: 'string' },
// //         required_skills: { type: 'array', items: { type: 'string' } },
// //         preferred_skills: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
// //         years_experience_min: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
// //         employment_type: { anyOf: [{ type: 'string' }, { type: 'null' }] },
// //         remote_policy: { anyOf: [{ type: 'string' }, { type: 'null' }] },
// //         industry: { anyOf: [{ type: 'string' }, { type: 'null' }] },
// //         key_responsibilities: { anyOf: [{ type: 'array', items: { type: 'string' }, maxItems: 5 }, { type: 'null' }] },
// //         screening_questions: { anyOf: [{ type: 'array', items: { type: 'string' }, maxItems: 5 }, { type: 'null' }] },
// //         deal_breakers: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
// //     },
// //     required: [
// //         'job_title',
// //         'seniority_level',
// //         'domain',
// //         'required_skills',
// //         'preferred_skills',
// //         'years_experience_min',
// //         'employment_type',
// //         'remote_policy',
// //         'industry',
// //         'key_responsibilities',
// //         'screening_questions',
// //         'deal_breakers',
// //     ],
// //     additionalProperties: false,
// // };


// const JD_EXTRACTION_SCHEMA = {
//     type: 'object',
//     properties: {
//         job_title: { type: 'string' },
//         seniority_level: { type: 'string' },
//         domain: { type: 'string' },
//         required_skills: {
//             type: 'array',
//             items: { type: 'string' }
//         },
//         preferred_skills: {
//             type: 'array',
//             items: { type: 'string' }
//         },
//         years_experience_min: { type: 'integer' },
//         employment_type: { type: 'string' },
//         remote_policy: { type: 'string' },
//         industry: { type: 'string' },
//         key_responsibilities: {
//             type: 'array',
//             items: { type: 'string' }
//         },
//         screening_questions: {
//             type: 'array',
//             items: { type: 'string' }
//         },
//         deal_breakers: {
//             type: 'array',
//             items: { type: 'string' }
//         }
//     },
//     required: ['job_title', 'required_skills'],
//     additionalProperties: false
// };


// /**
//  * Parses a raw JD string into a structured object with embeddings.
//  * @param {string} rawJd
//  * @returns {Promise<StructuredJD>}
//  */
// export async function parseJD(rawJd) {
//     const parsed = await extractStructuredJD(rawJd);

//     // Validate required fields
//     if (!parsed.required_skills?.length) {
//         throw new Error('PARSE_QUALITY_LOW: No required skills extracted. Check JD content.');
//     }

//     // Generate dual embeddings in parallel
//     const [jdSkillEmbedding, jdContextEmbedding] = await Promise.all([
//         getEmbedding(parsed.required_skills.concat(parsed.preferred_skills).join(', ')),
//         getEmbedding(`${parsed.job_title} ${parsed.domain} ${parsed.key_responsibilities?.join(' ')}`),
//     ]);

//     const parseQuality = Math.min(1.0, parsed.required_skills.length / 5);

//     return {
//         jobTitle: parsed.job_title,
//         seniorityLevel: parsed.seniority_level,
//         domain: parsed.domain,
//         requiredSkills: parsed.required_skills,
//         preferredSkills: parsed.preferred_skills ?? [],
//         yearsExperienceMin: parsed.years_experience_min,
//         employmentType: parsed.employment_type,
//         remotePolicy: parsed.remote_policy,
//         industry: parsed.industry,
//         keyResponsibilities: parsed.key_responsibilities ?? [],
//         screeningQuestions: parsed.screening_questions ?? [],
//         dealBreakers: parsed.deal_breakers ?? [],
//         parseQuality,
//         jdSkillEmbedding,
//         jdContextEmbedding,
//     };
// }

// async function extractStructuredJD(rawJd) {
//     const messages = [
//         {
//             role: 'system',
//             // content: `You are a precise job description parser. Extract structured data exactly as specified.
//             //   Normalize all skill names to lowercase. Separate must-haves from nice-to-haves strictly.
//             //   Return valid JSON only, no prose, no markdown.`,
//             content: `
// You are a strict JSON generator.

// Rules:
// - Output ONLY valid JSON
// - Do NOT include explanations or markdown
// - Do NOT omit required keys
// - If a value is unknown:
//   - use "" for strings
//   - use [] for arrays
//   - use 0 for numbers

// Normalize:
// - skills must be lowercase
// - no duplicates

// Return JSON matching schema exactly.
// `
//         },
//         { role: 'user', content: rawJd },
//     ];

//     try {
//         const response = await openai.chat.completions.create({
//             model: CHAT_MODEL,
//             temperature: 0,
//             max_tokens: 700,
//             response_format: {
//                 type: 'json_schema',
//                 json_schema: { name: 'structured_jd', strict: true, schema: JD_EXTRACTION_SCHEMA },
//             },
//             messages,
//         });
//         return normalizeParsedJD(JSON.parse(response.choices[0].message.content));
//     } catch (err) {
//         if (err?.code !== 'json_validate_failed') throw err;

//         console.warn('[JD Parser] Strict schema generation failed, retrying with json_object fallback.');
//         const fallbackResponse = await openai.chat.completions.create({
//             model: CHAT_MODEL,
//             temperature: 0,
//             max_tokens: 700,
//             response_format: { type: 'json_object' },
//             messages: [
//                 messages[0],
//                 {
//                     role: 'user',
//                     content: `
// Extract structured data from this job description.

// Return ONLY valid JSON.

// Rules:
// - Use EXACT keys:
// job_title, seniority_level, domain, required_skills, preferred_skills, years_experience_min, employment_type, remote_policy, industry, key_responsibilities, screening_questions, deal_breakers

// - If unknown:
//   - string → ""
//   - array → []
//   - number → 0

// - skills must be lowercase

// NO explanations. ONLY JSON.
// `
//                     //                     content: `${rawJd}

//                     // Return JSON with EXACT keys:
//                     // job_title, seniority_level, domain, required_skills, preferred_skills, years_experience_min, employment_type, remote_policy, industry, key_responsibilities, screening_questions, deal_breakers.
//                     // Use null for unknown scalar fields and [] for unknown array fields.`,
//                 },
//             ],
//         });
//         return normalizeParsedJD(JSON.parse(fallbackResponse.choices[0].message.content));
//     }
// }

// function normalizeParsedJD(parsed) {
//     const clean = {
//         job_title: asString(parsed?.job_title),
//         seniority_level: normalizeSeniority(parsed?.seniority_level),
//         domain: asString(parsed?.domain),
//         required_skills: asStringArray(parsed?.required_skills),
//         preferred_skills: asStringArray(parsed?.preferred_skills),
//         years_experience_min: asNullableInt(parsed?.years_experience_min),
//         employment_type: asNullableString(parsed?.employment_type),
//         remote_policy: asNullableString(parsed?.remote_policy),
//         industry: asNullableString(parsed?.industry),
//         key_responsibilities: asStringArray(parsed?.key_responsibilities).slice(0, 5),
//         screening_questions: asStringArray(parsed?.screening_questions).slice(0, 5),
//         deal_breakers: asStringArray(parsed?.deal_breakers),
//     };
//     return clean;
// }

// function asString(v) {
//     return typeof v === 'string' ? v.trim() : '';
// }

// function asNullableString(v) {
//     if (typeof v !== 'string') return null;
//     const value = v.trim();
//     return value.length ? value : null;
// }

// function asStringArray(v) {
//     if (!Array.isArray(v)) return [];
//     return v
//         .map(x => (typeof x === 'string' ? x.trim().toLowerCase() : ''))
//         .filter(Boolean);
// }

// function asNullableInt(v) {
//     if (v === null || v === undefined || v === '') return null;
//     const n = Number(v);
//     if (!Number.isFinite(n)) return null;
//     const intVal = Math.max(0, Math.floor(n));
//     return intVal;
// }

// function normalizeSeniority(v) {
//     const allowed = ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'];
//     if (typeof v !== 'string') return 'mid';
//     const value = v.trim().toLowerCase();
//     return allowed.includes(value) ? value : 'mid';
// }




import openai from '../config/openai.js';
import { getEmbedding } from '../utils/embedding.util.js';
import { safeParseJson } from '../utils/llmJson.util.js';

// ⚠️ Prefer a stronger model if available
const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';

/**
 * Lightweight schema (no anyOf / null)
 */
const JD_EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
        job_title: { type: 'string' },
        seniority_level: { type: 'string' },
        domain: { type: 'string' },
        required_skills: {
            type: 'array',
            items: { type: 'string' }
        },
        preferred_skills: {
            type: 'array',
            items: { type: 'string' }
        },
        years_experience_min: { type: 'integer' },
        years_experience_max: { type: 'integer' },
        education_requirement: { type: 'string' },
        employment_type: { type: 'string' },
        remote_policy: { type: 'string' },
        industry: { type: 'string' },
        key_responsibilities: {
            type: 'array',
            items: { type: 'string' }
        },
        screening_questions: {
            type: 'array',
            items: { type: 'string' }
        },
        deal_breakers: {
            type: 'array',
            items: { type: 'string' }
        }
    },
    required: ['job_title', 'required_skills'],
    additionalProperties: false
};

/**
 * MAIN PARSER
 */
export async function parseJD(rawJd) {
    const preprocessed = preprocessJd(rawJd);
    let parsed = await extractStructuredJD(preprocessed.promptText, { strictSkills: false });

    if (!parsed.required_skills?.length) {
        parsed = await extractStructuredJD(preprocessed.promptText, { strictSkills: true });
    }

    if (!parsed.required_skills?.length) {
        const err = new Error('PARSE_QUALITY_LOW: No required skills extracted.');
        err.code = 'PARSE_QUALITY_LOW';
        err.parseQuality = 0;
        err.details = { language: preprocessed.language };
        throw err;
    }

    // Generate embeddings
    const [jdSkillEmbedding, jdContextEmbedding] = await Promise.all([
        getEmbedding(
            [...parsed.required_skills, ...parsed.preferred_skills].join(', ')
        ),
        getEmbedding(
            `${parsed.job_title} ${parsed.domain} ${parsed.key_responsibilities.join(' ')}`
        )
    ]);

    const parseQuality = Math.min(1.0, parsed.required_skills.length / 5);

    return {
        jobTitle: parsed.job_title,
        seniorityLevel: parsed.seniority_level,
        domain: parsed.domain,
        requiredSkills: parsed.required_skills,
        preferredSkills: parsed.preferred_skills,
        yearsExperienceMin: parsed.years_experience_min,
        yearsExperienceMax: parsed.years_experience_max,
        educationRequirement: parsed.education_requirement,
        employmentType: parsed.employment_type,
        remotePolicy: parsed.remote_policy,
        industry: parsed.industry,
        keyResponsibilities: parsed.key_responsibilities,
        screeningQuestions: parsed.screening_questions,
        dealBreakers: parsed.deal_breakers,
        parseQuality,
        jdSkillEmbedding,
        jdContextEmbedding
    };
}

/**
 * CORE EXTRACTION LOGIC
 */
async function extractStructuredJD(rawJd, { strictSkills = false } = {}) {
    const shouldFallback = (err) => {
        if (!err) return false;
        if (err.code === 'json_validate_failed') return true;
        if (typeof err.message === 'string' && /json|parse|schema/i.test(err.message)) return true;
        return false;
    };

    const systemPrompt = `
You are a strict JSON generator.

Rules:
- Output ONLY valid JSON
- No explanations, no markdown, no comments
- Use EXACT keys from schema
- If unknown:
  - string → ""
  - array → []
  - number → 0

Normalize:
- skills must be lowercase
- remove duplicates

If you are unsure, still return valid JSON with best guess. NEVER return invalid JSON.
`;
    const strictPrompt = strictSkills
        ? '\nIMPORTANT: required_skills must not be empty. Infer from responsibilities/requirements when explicit skills are missing.'
        : '';

    const messages = [
        { role: 'system', content: `${systemPrompt}${strictPrompt}` },
        { role: 'user', content: rawJd }
    ];

    // -------- STRICT TRY --------
    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0,
            max_tokens: 800,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'structured_jd',
                    schema: JD_EXTRACTION_SCHEMA
                }
            },
            messages
        });

        const raw = response.choices?.[0]?.message?.content;

        if (!raw) throw new Error('EMPTY_RESPONSE');

        console.debug('[JD Parser] strict parse response received.');

        return normalizeParsedJD(safeParseJson(raw));

    } catch (err) {
        if (!shouldFallback(err)) throw err;
        console.warn('[JD Parser] Strict mode failed → fallback', err?.code);

        return fallbackExtraction(rawJd, systemPrompt);
    }
}

/**
 * FALLBACK MODE (VERY IMPORTANT)
 */
async function fallbackExtraction(rawJd, systemPrompt) {
    try {
        const response = await openai.chat.completions.create({
            model: CHAT_MODEL,
            temperature: 0,
            max_tokens: 800,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `
Extract structured data from this job description.

Return ONLY JSON with keys:
job_title, seniority_level, domain, required_skills, preferred_skills, years_experience_min, years_experience_max, education_requirement, employment_type, remote_policy, industry, key_responsibilities, screening_questions, deal_breakers

Rules:
- string → ""
- array → []
- number → 0
- skills must be lowercase

JD:
${rawJd}
`
                }
            ]
        });

        const raw = response.choices?.[0]?.message?.content;

        console.debug('[JD Parser] fallback parse response received.');

        try {
            return normalizeParsedJD(safeParseJson(raw));
        } catch (e) {
            console.error('JSON parse failed, applying repair...');
            const repaired = repairJSON(raw);
            return normalizeParsedJD(safeParseJson(repaired));
        }
    } catch (err) {
        if (err?.code === 'json_validate_failed' || /json|parse|schema/i.test(String(err?.message ?? ''))) {
            console.warn('[JD Parser] json_object fallback failed. Using heuristic local parser.');
            return heuristicExtractJD(rawJd);
        }
        throw err;
    }
}

/**
 * SIMPLE JSON REPAIR (no dependency)
 */
function repairJSON(str) {
    if (!str) return '{}';

    try {
        return str
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
    } catch {
        return '{}';
    }
}

/**
 * NORMALIZATION
 */
function normalizeParsedJD(parsed) {
    return {
        job_title: asString(parsed?.job_title),
        seniority_level: normalizeSeniority(parsed?.seniority_level),
        domain: asString(parsed?.domain),
        required_skills: unique(asStringArray(parsed?.required_skills)),
        preferred_skills: unique(asStringArray(parsed?.preferred_skills)),
        years_experience_min: asNullableInt(parsed?.years_experience_min),
        years_experience_max: asNullableInt(parsed?.years_experience_max),
        education_requirement: asNullableString(parsed?.education_requirement),
        employment_type: asNullableString(parsed?.employment_type),
        remote_policy: asNullableString(parsed?.remote_policy),
        industry: asNullableString(parsed?.industry),
        key_responsibilities: asStringArray(parsed?.key_responsibilities).slice(0, 5),
        screening_questions: asStringArray(parsed?.screening_questions).slice(0, 5),
        deal_breakers: asStringArray(parsed?.deal_breakers)
    };
}

/**
 * HELPERS
 */
function asString(v) {
    return typeof v === 'string' ? v.trim() : '';
}

function asNullableString(v) {
    if (typeof v !== 'string') return null;
    const val = v.trim();
    return val.length ? val : null;
}

function asStringArray(v) {
    if (!Array.isArray(v)) return [];
    return v
        .map(x => (typeof x === 'string' ? x.trim().toLowerCase() : ''))
        .filter(Boolean);
}

function asNullableInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function normalizeSeniority(v) {
    const allowed = ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'];
    const value = typeof v === 'string' ? v.toLowerCase().trim() : '';
    return allowed.includes(value) ? value : 'mid';
}

function unique(arr) {
    return [...new Set(arr)];
}

function heuristicExtractJD(rawJd) {
    const text = String(rawJd ?? '');
    const lower = text.toLowerCase();

    const titleMatch = text.match(/job\s*title\s*:\s*(.+)/i);
    const yearsMatch = text.match(/(\d+)\s*\+?\s*years?/i);
    const domain = inferDomain(lower);
    const required = inferRequiredSkills(lower);
    const preferred = inferPreferredSkills(lower, required);

    return normalizeParsedJD({
        job_title: titleMatch?.[1]?.trim() || 'Untitled role',
        seniority_level: inferSeniority(lower, yearsMatch ? Number(yearsMatch[1]) : null),
        domain,
        required_skills: required,
        preferred_skills: preferred,
        years_experience_min: yearsMatch ? Number(yearsMatch[1]) : null,
        years_experience_max: null,
        education_requirement: '',
        employment_type: inferEmploymentType(lower),
        remote_policy: inferRemotePolicy(lower),
        industry: '',
        key_responsibilities: extractSectionBullets(text, /(key responsibilities|responsibilities)/i),
        screening_questions: [],
        deal_breakers: [],
    });
}

function inferDomain(lower) {
    if (lower.includes('mern') || lower.includes('react') || lower.includes('node.js')) return 'software engineering';
    if (lower.includes('machine learning') || lower.includes('llm') || lower.includes('nlp')) return 'machine learning';
    return 'general';
}

function inferSeniority(lower, years) {
    if (lower.includes('staff')) return 'staff';
    if (lower.includes('principal')) return 'principal';
    if (lower.includes('senior') || (years !== null && years >= 5)) return 'senior';
    if (years !== null && years <= 2) return 'junior';
    return 'mid';
}

function inferEmploymentType(lower) {
    if (lower.includes('full-time')) return 'full-time';
    if (lower.includes('contract')) return 'contract';
    if (lower.includes('part-time')) return 'part-time';
    return null;
}

function inferRemotePolicy(lower) {
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('hybrid')) return 'hybrid';
    if (lower.includes('on-site') || lower.includes('onsite')) return 'on-site';
    return null;
}

function inferRequiredSkills(lower) {
    const skillBank = [
        'javascript', 'typescript', 'react', 'node.js', 'express.js', 'mongodb', 'sql',
        'html', 'css', 'restful apis', 'git', 'docker', 'aws', 'redux', 'zustand',
        'jwt', 'oauth', 'ci/cd', 'python', 'java', 'go', 'kubernetes', 'terraform',
        'postgresql', 'spark', 'airflow', 'pandas', 'machine learning', 'data science',
        'product management', 'figma', 'tableau', 'power bi',
    ];
    return skillBank.filter((s) => lower.includes(s));
}

function inferPreferredSkills(lower, required) {
    const preferredHints = ['typescript', 'redux', 'zustand', 'docker', 'aws', 'jwt', 'oauth', 'ci/cd'];
    const set = new Set(preferredHints.filter((s) => lower.includes(s)));
    for (const r of required) set.delete(r);
    return [...set];
}

function extractSectionBullets(text, sectionRegex) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const start = lines.findIndex((l) => sectionRegex.test(l));
    if (start < 0) return [];
    const out = [];
    for (let i = start + 1; i < lines.length && out.length < 5; i++) {
        const line = lines[i];
        if (/^(required skills|good to have|qualifications|what we offer)/i.test(line)) break;
        if (line.length > 4) out.push(line.replace(/^[•\-\d\.)\s]+/, ''));
    }
    return out;
}

function preprocessJd(rawJd) {
    const cleaned = normalizeWhitespace(stripHtml(rawJd));
    const language = detectLanguage(cleaned);
    const segments = segmentJdBlocks(cleaned);
    const segmentText = Object.entries(segments)
        .filter(([, value]) => value.length > 0)
        .map(([key, value]) => `${key.toUpperCase()}:\n${value.join('\n')}`)
        .join('\n\n');

    return {
        language,
        promptText: `Detected language: ${language}\n\n${cleaned}\n\n${segmentText}`.trim(),
    };
}

function stripHtml(input) {
    return String(input ?? '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(input) {
    return String(input ?? '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function detectLanguage(text) {
    const lower = String(text ?? '').toLowerCase();
    const englishMarkers = [' the ', ' and ', ' with ', ' years ', ' experience ', ' required ', ' skills ', ' role '];
    const hits = englishMarkers.reduce((count, marker) => count + (lower.includes(marker) ? 1 : 0), 0);
    return hits >= 2 ? 'english' : 'unknown';
}

function segmentJdBlocks(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const buckets = {
        title: [],
        responsibilities: [],
        requirements: [],
        benefits: [],
        other: [],
    };
    let active = 'other';

    for (const line of lines) {
        if (/^(job title|title)\b/i.test(line)) active = 'title';
        else if (/^(responsibilities|what you(?:'ll| will) do|role overview)\b/i.test(line)) active = 'responsibilities';
        else if (/^(requirements|qualifications|must have|skills)\b/i.test(line)) active = 'requirements';
        else if (/^(benefits|what we offer|perks)\b/i.test(line)) active = 'benefits';
        buckets[active].push(line.replace(/^[•\-\d\.)\s]+/, '').trim());
    }
    return buckets;
}