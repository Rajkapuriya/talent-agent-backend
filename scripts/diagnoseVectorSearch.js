import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Candidate from '../src/models/Candidate.js';

const INDEX_NAME = process.env.VECTOR_INDEX_NAME ?? 'candidate_profile_vector_index';

async function run() {
    await connectDB();
    try {
        const dbName = mongoose.connection?.db?.databaseName ?? '(unknown)';
        const totalCandidates = await Candidate.countDocuments({});
        const withEmbedding = await Candidate.countDocuments({
            profileEmbedding: { $exists: true, $type: 'array' },
        });
        const withoutEmbedding = await Candidate.countDocuments({
            $or: [{ profileEmbedding: { $exists: false } }, { profileEmbedding: { $size: 0 } }],
        });

        const dimBuckets = await Candidate.aggregate([
            {
                $project: {
                    dim: {
                        $cond: [
                            { $isArray: '$profileEmbedding' },
                            { $size: '$profileEmbedding' },
                            0,
                        ],
                    },
                },
            },
            { $group: { _id: '$dim', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);

        const sample = await Candidate.findOne({
            profileEmbedding: { $exists: true, $type: 'array' },
        }).select('_id name profileEmbedding').lean();

        console.log(`[Diag] DB name: ${dbName}`);
        console.log(`[Diag] Candidates total: ${totalCandidates}`);
        console.log(`[Diag] Candidates with embedding: ${withEmbedding}`);
        console.log(`[Diag] Candidates without embedding: ${withoutEmbedding}`);
        console.log(`[Diag] Embedding dimension buckets: ${JSON.stringify(dimBuckets)}`);
        console.log(`[Diag] Vector index configured: ${INDEX_NAME}`);
        try {
            const indexMeta = await Candidate.aggregate([
                { $listSearchIndexes: {} },
                {
                    $project: {
                        name: 1,
                        status: 1,
                        queryable: 1,
                        type: 1,
                        latestDefinition: 1,
                    },
                },
            ]);
            console.log(`[Diag] Search indexes on collection: ${indexMeta.length}`);
            if (indexMeta.length) {
                const compact = indexMeta.map((idx) => ({
                    name: idx.name,
                    type: idx.type,
                    status: idx.status,
                    queryable: idx.queryable,
                    vectorFields: Array.isArray(idx?.latestDefinition?.fields)
                        ? idx.latestDefinition.fields
                            .filter((f) => f?.type === 'vector')
                            .map((f) => ({
                                path: f.path,
                                numDimensions: f.numDimensions,
                                similarity: f.similarity,
                            }))
                        : [],
                }));
                console.log(`[Diag] Search index metadata: ${JSON.stringify(compact)}`);
            }
        } catch (err) {
            console.warn('[Diag] Could not list search indexes via $listSearchIndexes:', err?.message ?? err);
        }

        if (!sample || !Array.isArray(sample.profileEmbedding) || sample.profileEmbedding.length === 0) {
            console.log('[Diag] No candidate with valid embedding found. Cannot run vector search test.');
            return;
        }

        console.log(`[Diag] Using sample candidate "${sample.name}" (${sample._id}) with dim=${sample.profileEmbedding.length}`);

        try {
            const vectorResults = await Candidate.aggregate([
                {
                    $vectorSearch: {
                        index: INDEX_NAME,
                        path: 'profileEmbedding',
                        queryVector: sample.profileEmbedding,
                        numCandidates: 50,
                        limit: 5,
                    },
                },
                { $project: { name: 1, vectorScore: { $meta: 'vectorSearchScore' } } },
            ]);

            console.log(`[Diag] Vector search results: ${vectorResults.length}`);
            if (vectorResults.length) {
                console.log(`[Diag] Top result: ${vectorResults[0].name} score=${vectorResults[0].vectorScore}`);
            } else {
                console.log('[Diag] Vector search returned 0 rows. Most likely index name, index build status, or dim mismatch.');
            }
        } catch (err) {
            console.error('[Diag] Vector search query failed:', err?.message ?? err);
        }
    } finally {
        await disconnectDB();
    }
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Diag] Fatal error:', err);
        process.exit(1);
    });
