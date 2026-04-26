/**
 * Computes cosine similarity between two equal-length vectors.
 * Returns a value in [0, 1] — 1 means identical direction.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
    const dims = Math.min(a.length, b.length);
    if (dims === 0) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < dims; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;

    // Clamp to [0, 1] — floating point can give tiny negatives
    return Math.max(0, Math.min(1, dot / denom));
}