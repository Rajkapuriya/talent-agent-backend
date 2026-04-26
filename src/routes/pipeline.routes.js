import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { parseJD } from '../services/jdParser.service.js';
import { discoverCandidates } from '../services/candidateDiscovery.service.js';
import { scoreCandidate } from '../services/matchScoring.service.js';
import { runConversation } from '../services/conversationAgent.service.js';
import { computeCombinedScore, assignTier, generateScoreCard, generateAggregateInsights } from '../services/ranking.service.js';
import Job from '../models/Job.js';
import MatchResult from '../models/MatchResult.js';
import InterestResult from '../models/InterestResult.js';
import Shortlist from '../models/Shortlist.js';
import pipelineEmitter from '../utils/pipelineemitter.js';
import { runBiasAudit } from '../utils/biasAudit.util.js';

const router = express.Router();

/**
 * POST /api/pipeline/run
 * Runs the full pipeline for a given jobId.
 * Streams progress via SSE — client connects to GET /api/pipeline/:runId/progress.
 */
router.post('/run', authenticate, async (req, res) => {
    const { jobId } = req.body;
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Start pipeline async — respond immediately with runId
    const runId = `run_${Date.now()}`;
    job.pipelineRunId = runId;
    job.status = 'running';
    await job.save();

    res.json({ runId, message: 'Pipeline started. Connect to SSE for progress.' });

    // Run pipeline in background (do not await)
    runFullPipeline(job, runId).catch(err => {
        console.error('[Pipeline Error]', err);
        pipelineEmitter.emit(runId, { stage: 'error', message: err.message ?? 'Pipeline failed' });
        Job.findByIdAndUpdate(jobId, { status: 'error' }).exec();
    });
});

/**
 * GET /api/pipeline/:runId/progress
 * Server-Sent Events stream for real-time pipeline progress.
 */
router.get('/:runId/progress', authenticate, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Attach this response to the event emitter keyed by runId
    const listener = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (data.stage === 'complete' || data.stage === 'error') res.end();
    };
    pipelineEmitter.on(req.params.runId, listener);

    req.on('close', () => pipelineEmitter.off(req.params.runId, listener));
});

// Internal pipeline runner
async function runFullPipeline(job, runId) {
    const emit = (stage, payload) => pipelineEmitter.emit(runId, { stage, ...payload });

    emit('parsing', { message: 'Parsing job description...' });
    let structured;
    try {
        structured = await parseJD(job.rawJd);
    } catch (err) {
        if (err?.code === 'PARSE_QUALITY_LOW') {
            emit('error', {
                code: 'PARSE_QUALITY_LOW',
                parseQuality: err.parseQuality ?? 0,
                message: err.message,
            });
            await Job.findByIdAndUpdate(job._id, { status: 'error' });
            return;
        }
        throw err;
    }
    job.structured = structured;
    job.status = 'parsed';
    await job.save();
    emit('parsed', { parseQuality: structured.parseQuality, skills: structured.requiredSkills });

    emit('discovering', { message: 'Discovering candidates...' });
    const candidatePool = await discoverCandidates(structured);
    emit('discovered', { count: candidatePool.length });
    if (candidatePool.length < 5) {
        emit('warning', {
            code: 'JD_TOO_RESTRICTIVE',
            message: 'Fewer than 5 candidates found after discovery and relaxation.',
        });
    }

    emit('scoring', { message: 'Scoring candidates...', total: candidatePool.length });
    const matchResults = [];
    for (const { candidate } of candidatePool) {
        const result = await scoreCandidate(candidate, structured);
        const saved = await MatchResult.create({ jobId: job._id, candidateId: candidate._id, ...result });
        matchResults.push({ candidate, matchResult: saved });
        emit('scored', { candidateId: candidate._id, matchScore: result.matchScore });
    }

    // Filter for outreach (match >= 50, not suppressed)
    const outreachPool = matchResults.filter(r => r.matchResult.matchScore >= 50 && !r.matchResult.suppressed);
    emit('engaging', { message: 'Running outreach simulations...', total: outreachPool.length });

    const interestResults = [];
    for (const { candidate, matchResult } of outreachPool) {
        const result = await runConversation(candidate, structured, matchResult);
        const saved = await InterestResult.create({ jobId: job._id, candidateId: candidate._id, ...result });
        interestResults.push({ candidate, matchResult, interestResult: saved });
        emit('engaged', { candidateId: candidate._id, interestScore: result.interestScore });
    }

    emit('ranking', { message: 'Building shortlist...' });
    const entries = [];
    for (const { candidate, matchResult, interestResult } of interestResults) {
        const combinedScore = computeCombinedScore(matchResult.matchScore, interestResult.interestScore);
        const tier = assignTier(combinedScore);
        const scoreCard = ['tier1', 'tier2'].includes(tier)
            ? await generateScoreCard(candidate, matchResult, interestResult,
                { match: matchResult.matchScore, interest: interestResult.interestScore, combined: combinedScore })
            : null;
        entries.push({
            candidateId: candidate._id, matchResultId: matchResult._id,
            interestResultId: interestResult._id,
            matchScore: matchResult.matchScore, interestScore: interestResult.interestScore,
            combinedScore, tier, scoreCard,
        });
    }

    entries.sort((a, b) => b.combinedScore - a.combinedScore);
    entries.forEach((e, i) => { e.rank = i + 1; });

    const aggregateInsights = await generateAggregateInsights(interestResults.map((result) => {
        const entry = entries.find((e) => e.candidateId.toString() === result.candidate._id.toString());
        return {
            ...entry,
            candidate: result.candidate,
            matchResult: result.matchResult,
            interestResult: result.interestResult,
        };
    }));

    const biasAudit = runBiasAudit(
        interestResults.map((result) => {
            const entry = entries.find((e) => e.candidateId.toString() === result.candidate._id.toString());
            return {
                ...entry,
                matchResult: result.matchResult,
                interestResult: result.interestResult,
            };
        }),
        aggregateInsights
    );
    if (!biasAudit.passed) {
        emit('warning', {
            code: 'BIAS_AUDIT_FLAGGED',
            message: 'Protected attributes detected in generated summaries; review output before action.',
            findings: biasAudit.findings,
        });
    }

    const shortlist = await Shortlist.create({
        jobId: job._id,
        entries,
        aggregateInsights,
        generatedAt: new Date(),
    });
    job.status = 'complete';
    await job.save();

    emit('complete', { shortlistId: shortlist._id, tierCounts: countTiers(entries) });
}

function countTiers(entries) {
    return entries.reduce((acc, e) => {
        acc[e.tier] = (acc[e.tier] ?? 0) + 1;
        return acc;
    }, {});
}

export default router;