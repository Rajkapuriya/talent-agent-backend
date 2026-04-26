import express from 'express';
import { z } from 'zod';
import Job from '../models/Job.js';
import Shortlist from '../models/Shortlist.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createError } from '../middleware/error.middleware.js';

const router = express.Router();

// All job routes require authentication
router.use(authenticate);

const CreateJobSchema = z.object({
    rawJd: z.string().min(200, 'Job description must be at least 200 characters'),
});

/**
 * POST /api/jobs
 * Creates a new job document with raw JD.
 */
router.post('/', validate(CreateJobSchema), async (req, res, next) => {
    try {
        const job = await Job.create({
            rawJd: req.validatedBody.rawJd,
            createdBy: req.user.id,
            status: 'draft',
        });
        res.status(201).json(job);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/jobs
 * Lists all jobs for the authenticated recruiter.
 * Includes shortlist count as a virtual field.
 */
router.get('/', async (req, res, next) => {
    try {
        const jobs = await Job.find({ createdBy: req.user.id })
            .sort({ createdAt: -1 })
            .select('-structured.jdSkillEmbedding -structured.jdContextEmbedding')
            .lean();

        // Attach shortlist counts efficiently
        const jobIds = jobs.map(j => j._id);
        const shortlists = await Shortlist.find(
            { jobId: { $in: jobIds } },
            { jobId: 1, 'entries': { $elemMatch: { tier: { $in: ['tier1', 'tier2'] } } } }
        ).lean();

        const countMap = {};
        for (const s of shortlists) {
            countMap[s.jobId.toString()] = s.entries?.length ?? 0;
        }

        const enriched = jobs.map(j => ({
            ...j,
            shortlistCount: countMap[j._id.toString()] ?? null,
        }));

        res.json(enriched);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/jobs/:id
 * Returns a single job with full structured JD (embeddings excluded).
 */
router.get('/:id', async (req, res, next) => {
    try {
        const job = await Job.findOne({ _id: req.params.id, createdBy: req.user.id })
            .select('-structured.jdSkillEmbedding -structured.jdContextEmbedding')
            .lean();

        if (!job) throw createError(404, 'Job not found');
        res.json(job);
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/jobs/:id
 * Updates job status or raw JD (before pipeline runs).
 */
router.patch('/:id', async (req, res, next) => {
    try {
        const allowed = ['status'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        const job = await Job.findOneAndUpdate(
            { _id: req.params.id, createdBy: req.user.id },
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!job) throw createError(404, 'Job not found');
        res.json(job);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/jobs/:id
 * Soft-deletes by setting status to 'archived'.
 * Also removes associated shortlist and match/interest results.
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const job = await Job.findOne({ _id: req.params.id, createdBy: req.user.id });
        if (!job) throw createError(404, 'Job not found');

        // Cascade delete associated data
        await Promise.all([
            Shortlist.deleteOne({ jobId: job._id }),
        ]);

        await job.deleteOne();
        res.json({ message: 'Job deleted' });
    } catch (err) {
        next(err);
    }
});

export default router;