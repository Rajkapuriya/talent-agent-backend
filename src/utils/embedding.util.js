import openai from '../config/openai.js';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
const FALLBACK_DIMS = Number(process.env.LOCAL_EMBEDDING_DIMS ?? 1536);
const FORCE_LOCAL = String(process.env.EMBEDDING_MODE ?? '').toLowerCase() === 'local';

/**
 * Generates an embedding vector for a given text string.
 * Uses configurable embedding model (defaults to text-embedding-3-small).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
    if (!text || text.trim().length === 0) {
        throw new Error('[Embedding] Cannot embed empty text');
    }
    if (FORCE_LOCAL) {
        return getLocalDeterministicEmbedding(text, FALLBACK_DIMS);
    }

    try {
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text.slice(0, 8000),  // API token limit guard
        });
        return response.data[0].embedding;
    } catch (err) {
        // Provider/model/auth mismatch is common when chat uses Groq but embeddings are unavailable.
        if (shouldUseLocalEmbeddingFallback(err)) {
            console.warn(
                `[Embedding] Provider/model unavailable for "${EMBEDDING_MODEL}". Falling back to local deterministic embeddings (${FALLBACK_DIMS} dims).`,
            );
            return getLocalDeterministicEmbedding(text, FALLBACK_DIMS);
        }
        throw err;
    }
}

/**
 * Batch-generates embeddings for an array of texts.
 * Respects provider rate limits by processing in chunks.
 * @param {string[]} texts
 * @param {number} chunkSize
 * @returns {Promise<number[][]>}
 */
export async function getBatchEmbeddings(texts, chunkSize = 20) {
    const results = [];
    for (let i = 0; i < texts.length; i += chunkSize) {
        const chunk = texts.slice(i, i + chunkSize);
        const chunkEmbeddings = await Promise.all(chunk.map(getEmbedding));
        results.push(...chunkEmbeddings);
    }
    return results;
}

function getLocalDeterministicEmbedding(text, dims) {
    const vec = new Array(dims).fill(0);
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    for (const token of tokens) {
        const h1 = fnv1a32(token);
        const h2 = fnv1a32(`${token}_alt`);
        const idx1 = h1 % dims;
        const idx2 = h2 % dims;
        vec[idx1] += 1;
        vec[idx2] -= 0.5;
    }

    // L2 normalize for cosine similarity stability.
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return vec.map(v => v / norm);
}

function fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function shouldUseLocalEmbeddingFallback(err) {
    const message = String(err?.message ?? '').toLowerCase();
    const code = String(err?.code ?? '').toLowerCase();
    const status = Number(err?.status);
    return (
        status === 401 ||
        status === 403 ||
        status === 404 ||
        code === 'model_not_found' ||
        code === 'invalid_api_key' ||
        code === 'insufficient_quota' ||
        message.includes('api key') ||
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('quota') ||
        message.includes('model not found')
    );
}