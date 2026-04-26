import Candidate from '../models/Candidate.js';
import { cosineSimilarity } from '../utils/cosineSimilarity.util.js';
import { normalizeSkills } from '../utils/scoring.util.js';

const ACTIVITY_BOOST = { fresh: 0.15, recent: 0.08, stale: -0.05 };
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'candidate_profile_vector_index';

/**
 * Discovers matching candidates using Atlas Vector Search + hard filters.
 * @param {StructuredJD} jd
 * @returns {Promise<Array<{candidate, retrievalScore}>>}
 */
export async function discoverCandidates(jd) {
    const hardFilter = buildHardFilter(jd);
    const dealBreakers = normalizeSkills(jd.dealBreakers);

    let skillMatches = [];
    let contextMatches = [];
    try {
        // Run dual vector searches in parallel
        [skillMatches, contextMatches] = await Promise.all([
            runVectorSearch(jd.jdSkillEmbedding, hardFilter, 30),
            runVectorSearch(jd.jdContextEmbedding, hardFilter, 30),
        ]);
    } catch (err) {
        if (!isSearchNotEnabledError(err)) throw err;
        console.warn('[Discovery] Atlas vector search unavailable. Using local cosine fallback.');
        return runLocalDiscoveryFallback(jd, hardFilter, 50);
    }

    // Union + deduplicate by candidate ID
    const combined = dedupeAndMergeByCandidate([...skillMatches, ...contextMatches]);
    if (combined.length === 0) {
        console.warn('[Discovery] Atlas vector search returned 0 combined results. Falling back to local cosine retrieval.');
        return runLocalDiscoveryFallback(jd, hardFilter, 50);
    }
    const gatedCombined = applyDealBreakerGate(combined, dealBreakers);

    // Apply recency boost
    const boosted = gatedCombined.map(c => ({
        candidate: c,
        retrievalScore: c.vectorScore * (1 + getActivityBoost(c.lastActiveDaysAgo)),
    }));

    // If pool is too small, relax filters and retry
    if (boosted.length < 15) {
        console.warn(`[Discovery] Only ${boosted.length} candidates found. Relaxing filters.`);
        const [relaxedSkill, relaxedContext] = await Promise.all([
            runVectorSearch(jd.jdSkillEmbedding, {}, 40),
            runVectorSearch(jd.jdContextEmbedding, {}, 40),
        ]);
        const relaxed = applyDealBreakerGate(
            dedupeAndMergeByCandidate([...relaxedSkill, ...relaxedContext]),
            dealBreakers
        );
        const relaxedBoosted = relaxed.map((c) => ({
            candidate: c,
            retrievalScore: c.vectorScore * (1 + getActivityBoost(c.lastActiveDaysAgo)),
        }));
        const merged = mergeRankedCandidatePools(boosted, relaxedBoosted);
        if (merged.length === 0) {
            console.warn('[Discovery] Atlas relaxed retrieval still empty. Falling back to local cosine retrieval.');
            return runLocalDiscoveryFallback(jd, {}, 50);
        }
        return merged.slice(0, 50);
    }

    return boosted.sort((a, b) => b.retrievalScore - a.retrievalScore).slice(0, 50);
}

async function runVectorSearch(embedding, hardFilter, limit) {
    // NOTE: Atlas $vectorSearch `filter` only works for fields explicitly declared
    // as type "filter" in the vector index. To avoid zero-result issues when those
    // fields are not indexed, we apply hard filters as a post-$match stage instead.
    const postFilter = toMongoFilter(hardFilter);
    const hasPostFilter = Object.keys(postFilter).length > 0;

    const pipeline = [
        {
            $vectorSearch: {
                index: VECTOR_INDEX_NAME,
                path: 'profileEmbedding',
                queryVector: embedding,
                // Fetch more candidates to compensate for post-filter shrinkage
                numCandidates: hasPostFilter ? limit * 10 : limit * 5,
                limit: hasPostFilter ? limit * 3 : limit,
            },
        },
        { $addFields: { vectorScore: { $meta: 'vectorSearchScore' } } },
    ];

    if (hasPostFilter) {
        pipeline.push({ $match: postFilter });
        pipeline.push({ $limit: limit });
    }

    const results = await Candidate.aggregate(pipeline);
    if (results.length === 0) {
        console.warn(`[Discovery] $vectorSearch returned 0 results. Check: (1) Atlas vector index exists and is named "${VECTOR_INDEX_NAME}", (2) candidates have "profileEmbedding" field, (3) embedding dimensions match index numDimensions.`);
    }
    return results;
}

async function runLocalDiscoveryFallback(jd, hardFilter, limit) {
    const mongoFilter = toMongoFilter(hardFilter);
    const dealBreakers = normalizeSkills(jd.dealBreakers);
    const candidates = applyDealBreakerGate(await Candidate.find(mongoFilter).lean(), dealBreakers);
    const scored = candidates
        .map((candidate) => {
            const skillScore = cosineSimilarity(jd.jdSkillEmbedding, candidate.profileEmbedding);
            const contextScore = cosineSimilarity(jd.jdContextEmbedding, candidate.profileEmbedding);
            const vectorScore = Math.max(0, 0.6 * skillScore + 0.4 * contextScore);
            return {
                candidate,
                retrievalScore: vectorScore * (1 + getActivityBoost(candidate.lastActiveDaysAgo)),
            };
        })
        .sort((a, b) => b.retrievalScore - a.retrievalScore)
        .slice(0, limit);
    return scored;
}

function buildHardFilter(jd) {
    const filter = {};
    if (jd.yearsExperienceMin > 1) {
        filter.yearsExperience = { $gte: jd.yearsExperienceMin - 1 };
    }
    filter.availabilitySignal = { $in: ['actively_looking', 'open'] };
    if (jd.remotePolicy === 'remote') {
        filter.remoteOpen = true;
    }
    return filter;
}

function toMongoFilter(filter) {
    // Converts simple Atlas vector filter object to plain Mongo query.
    const query = {};
    for (const [k, v] of Object.entries(filter ?? {})) {
        query[k] = v;
    }
    return query;
}

function isSearchNotEnabledError(err) {
    return err?.code === 31082 || err?.codeName === 'SearchNotEnabled';
}

function getActivityBoost(daysAgo) {
    if (daysAgo < 7) return ACTIVITY_BOOST.fresh;
    if (daysAgo < 30) return ACTIVITY_BOOST.recent;
    if (daysAgo > 90) return ACTIVITY_BOOST.stale;
    return 0;
}

function dedupeAndMergeByCandidate(rows) {
    const map = new Map();
    for (const row of rows) {
        const id = row?._id?.toString?.();
        if (!id) continue;
        const existing = map.get(id);
        if (!existing || Number(row.vectorScore ?? 0) > Number(existing.vectorScore ?? 0)) {
            map.set(id, row);
        }
    }
    return [...map.values()];
}

function mergeRankedCandidatePools(primary, secondary) {
    const map = new Map();
    for (const row of [...primary, ...secondary]) {
        const id = row?.candidate?._id?.toString?.();
        if (!id) continue;
        const existing = map.get(id);
        if (!existing || row.retrievalScore > existing.retrievalScore) {
            map.set(id, row);
        }
    }
    return [...map.values()].sort((a, b) => b.retrievalScore - a.retrievalScore);
}

function applyDealBreakerGate(candidates, dealBreakers) {
    if (!Array.isArray(dealBreakers) || dealBreakers.length === 0) return candidates;
    const requiredSkills = normalizeSkills(dealBreakers);
    if (!requiredSkills.length) return candidates;
    return candidates.filter((candidate) => {
        const skillSet = new Set(normalizeSkills(candidate.skills));
        return requiredSkills.every((requiredSkill) => skillSet.has(requiredSkill));
    });
}