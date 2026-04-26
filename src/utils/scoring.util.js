// Canonical skill alias map — extend as needed
const ALIASES = {
    'js': 'javascript',
    'ts': 'typescript',
    'node': 'node.js',
    'nodejs': 'node.js',
    'react.js': 'react',
    'reactjs': 'react',
    'vue.js': 'vue',
    'vuejs': 'vue',
    'postgres': 'postgresql',
    'mongo': 'mongodb',
    'k8s': 'kubernetes',
    'tf': 'terraform',
    'ml': 'machine learning',
    'ai': 'artificial intelligence',
    'dl': 'deep learning',
    'nlp': 'natural language processing',
    'llm': 'large language models',
    'gql': 'graphql',
};

/**
 * Normalizes a list of skill strings:
 * - lowercase
 * - trim
 * - resolve aliases
 * @param {string[]} skills
 * @returns {string[]}
 */
export function normalizeSkills(skills) {
    if (!Array.isArray(skills)) return [];
    return skills
        .map(s => {
            const clean = s.toLowerCase().trim().replace(/[^a-z0-9#+.\s]/g, '');
            return ALIASES[clean] ?? clean;
        })
        .filter(Boolean);
}

/**
 * Returns the SENIORITY_LEVELS array index for a given level string.
 * Returns -1 if not found.
 */
export const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'];

export function seniorityIndex(level) {
    return SENIORITY_LEVELS.indexOf((level ?? '').toLowerCase().trim());
}