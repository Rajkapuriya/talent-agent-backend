import express from 'express';
import Shortlist from '../models/Shortlist.js';
import MatchResult from '../models/MatchResult.js';
import InterestResult from '../models/InterestResult.js';
import Candidate from '../models/Candidate.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { createError } from '../middleware/error.middleware.js';

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/shortlists/:jobId
 * Returns the full ranked shortlist for a job, with populated references.
 */
router.get('/:jobId', async (req, res, next) => {
    try {
        const shortlist = await Shortlist.findOne({ jobId: req.params.jobId }).lean();
        if (!shortlist) throw createError(404, 'Shortlist not found. Run the pipeline first.');

        // Populate candidate, match, and interest details for each entry
        const populated = await Promise.all(
            shortlist.entries.map(async (entry) => {
                const [candidate, matchResult, interestResult] = await Promise.all([
                    Candidate.findById(entry.candidateId).select('-profileEmbedding').lean(),
                    MatchResult.findById(entry.matchResultId).lean(),
                    InterestResult.findById(entry.interestResultId).lean(),
                ]);
                return { ...entry, candidate, matchResult, interestResult };
            })
        );

        res.json({ ...shortlist, entries: populated });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/shortlists/:jobId/export
 * Returns a CSV export of the ranked shortlist.
 */
router.get('/:jobId/export', async (req, res, next) => {
    try {
        const shortlist = await Shortlist.findOne({ jobId: req.params.jobId }).lean();
        if (!shortlist) throw createError(404, 'Shortlist not found');

        const rows = [
            ['Rank', 'Name', 'Tier', 'Match Score', 'Interest Score', 'Combined Score', 'Top Strength', 'Top Gap', 'Next Action'],
        ];

        for (const entry of shortlist.entries) {
            const [candidate, match, interest] = await Promise.all([
                Candidate.findById(entry.candidateId).select('name headline').lean(),
                MatchResult.findById(entry.matchResultId).select('topStrengths skillGaps').lean(),
                InterestResult.findById(entry.interestResultId).select('recommendedNextAction').lean(),
            ]);

            rows.push([
                entry.rank,
                candidate?.name ?? '',
                entry.tier,
                Math.round(entry.matchScore),
                Math.round(entry.interestScore),
                Math.round(entry.combinedScore),
                match?.topStrengths?.[0] ?? '',
                match?.skillGaps?.[0] ?? '',
                interest?.recommendedNextAction ?? '',
            ]);
        }

        const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="shortlist-${req.params.jobId}.csv"`);
        res.send(csv);
    } catch (err) {
        next(err);
    }
});

export default router;