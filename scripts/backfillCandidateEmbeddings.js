/**
 * Rebuilds profile embeddings for all candidates in batches.
 *
 * Usage:
 *   npm run embeddings:backfill
 *   npm run embeddings:backfill -- --batch=25 --dry-run
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Candidate from '../src/models/Candidate.js';
import { getEmbedding } from '../src/utils/embedding.util.js';

function parseArgs(argv) {
    const args = { batch: 20, dryRun: false };
    for (const raw of argv) {
        if (raw === '--dry-run') args.dryRun = true;
        if (raw.startsWith('--batch=')) {
            const value = Number(raw.split('=')[1]);
            if (Number.isFinite(value) && value > 0) args.batch = Math.floor(value);
        }
    }
    return args;
}

function buildEmbeddingText(candidate) {
    return [
        candidate.name,
        candidate.headline,
        candidate.currentRole,
        Number.isFinite(candidate.yearsExperience) ? `${candidate.yearsExperience} years experience` : null,
        Array.isArray(candidate.skills) ? candidate.skills.join(', ') : null,
        candidate.summary,
    ].filter(Boolean).join('. ');
}

async function backfillEmbeddings({ batch = 20, dryRun = false } = {}) {
    const total = await Candidate.countDocuments({});
    console.log(`[Backfill] Candidates found: ${total}`);
    if (total === 0) return;

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const cursor = Candidate.find({})
        .select('_id name headline currentRole yearsExperience skills summary profileEmbedding')
        .cursor();

    const rows = [];
    for await (const candidate of cursor) {
        rows.push(candidate);
        if (rows.length < batch) continue;
        const stats = await processBatch(rows, { dryRun });
        processed += stats.processed;
        updated += stats.updated;
        skipped += stats.skipped;
        failed += stats.failed;
        rows.length = 0;
        console.log(`[Backfill] Progress ${processed}/${total} | updated=${updated} skipped=${skipped} failed=${failed}`);
    }

    if (rows.length) {
        const stats = await processBatch(rows, { dryRun });
        processed += stats.processed;
        updated += stats.updated;
        skipped += stats.skipped;
        failed += stats.failed;
    }

    console.log(`[Backfill] Completed | processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`);
}

async function processBatch(candidates, { dryRun }) {
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
        const text = buildEmbeddingText(candidate);
        if (!text) {
            skipped++;
            continue;
        }

        try {
            const embedding = await getEmbedding(text);
            if (!Array.isArray(embedding) || embedding.length === 0) {
                throw new Error('Embedding provider returned an empty vector');
            }
            if (dryRun) {
                updated++;
                continue;
            }
            await Candidate.updateOne(
                { _id: candidate._id },
                { $set: { profileEmbedding: embedding } }
            );
            updated++;
        } catch (err) {
            failed++;
            console.error(`[Backfill] Failed for ${candidate._id}: ${err.message}`);
        }
    }

    return {
        processed: candidates.length,
        updated,
        skipped,
        failed,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await connectDB();
    try {
        await backfillEmbeddings(args);
    } finally {
        await disconnectDB();
    }
}

if (process.argv[1]?.includes('backfillCandidateEmbeddings')) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('[Backfill] Fatal error:', err);
            process.exit(1);
        });
}
