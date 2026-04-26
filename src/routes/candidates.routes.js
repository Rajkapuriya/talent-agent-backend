import express from 'express';
import { z } from 'zod';
import Candidate from '../models/Candidate.js';
import MatchResult from '../models/MatchResult.js';
import InterestResult from '../models/InterestResult.js';
import Shortlist from '../models/Shortlist.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { getEmbedding } from '../utils/embedding.util.js';
import { createError } from '../middleware/error.middleware.js';

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/candidates
 * Lists candidates with pagination, search, and filter support.
 */
router.get('/', async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            availability,
            remote,
        } = req.query;

        const filter = {};
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { headline: { $regex: search, $options: 'i' } },
                { skills: { $regex: search, $options: 'i' } },
            ];
        }
        if (availability) filter.availabilitySignal = availability;
        if (remote === 'true') filter.remoteOpen = true;

        const [candidates, total] = await Promise.all([
            Candidate.find(filter)
                .select('-profileEmbedding')
                .sort({ lastActiveDaysAgo: 1 })
                .skip((page - 1) * limit)
                .limit(Number(limit))
                .lean(),
            Candidate.countDocuments(filter),
        ]);

        res.json({
            candidates,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/candidates/:id
 * Returns a single candidate (without embedding).
 */
router.get('/:id', async (req, res, next) => {
    try {
        const candidate = await Candidate.findById(req.params.id)
            .select('-profileEmbedding')
            .lean();
        if (!candidate) throw createError(404, 'Candidate not found');
        res.json(candidate);
    } catch (err) {
        next(err);
    }
});

const CandidateSchema = z.object({
    name: z.string().min(2),
    headline: z.string().optional(),
    currentRole: z.string().optional(),
    yearsExperience: z.number().int().min(0).max(50),
    skills: z.array(z.string()).min(1),
    education: z.string().optional(),
    location: z.string().optional(),
    remoteOpen: z.boolean().default(true),
    employmentTypePreference: z.string().optional(),
    lastActiveDaysAgo: z.number().int().min(0).default(30),
    availabilitySignal: z.enum(['actively_looking', 'open', 'not_looking']).default('open'),
    summary: z.string().optional(),
    seniorityLevel: z.string().optional(),
});

const CandidateUpdateSchema = CandidateSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided' },
);

function buildEmbeddingText(data) {
    return [
        data.name,
        data.headline,
        data.currentRole,
        typeof data.yearsExperience === 'number' ? `${data.yearsExperience} years experience` : null,
        Array.isArray(data.skills) ? data.skills.join(', ') : null,
        data.summary,
    ].filter(Boolean).join('. ');
}

/**
 * POST /api/candidates
 * Creates a candidate and generates their profile embedding.
 */
router.post('/', validate(CandidateSchema), async (req, res, next) => {
    try {
        const data = req.validatedBody;
        const embeddingText = buildEmbeddingText(data);

        const profileEmbedding = await getEmbedding(embeddingText);
        const candidate = await Candidate.create({ ...data, profileEmbedding });

        res.status(201).json(
            // Return without embedding — it's internal
            { ...candidate.toObject(), profileEmbedding: undefined }
        );
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/candidates/:id
 * Updates candidate profile and refreshes profile embedding.
 */
router.put('/:id', validate(CandidateUpdateSchema), async (req, res, next) => {
    try {
        const existing = await Candidate.findById(req.params.id);
        if (!existing) throw createError(404, 'Candidate not found');

        Object.assign(existing, req.validatedBody);
        existing.profileEmbedding = await getEmbedding(buildEmbeddingText(existing.toObject()));
        await existing.save();

        const out = existing.toObject();
        delete out.profileEmbedding;
        res.json(out);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/candidates/:id
 * Deletes candidate from the pool.
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const candidateId = req.params.id;
        const candidate = await Candidate.findById(candidateId).select('_id');
        if (!candidate) throw createError(404, 'Candidate not found');

        const [shortlistLinked, matchLinked, interestLinked] = await Promise.all([
            Shortlist.exists({ 'entries.candidateId': candidateId }),
            MatchResult.exists({ candidateId }),
            InterestResult.exists({ candidateId }),
        ]);

        if (shortlistLinked || matchLinked || interestLinked) {
            throw createError(
                409,
                'Candidate cannot be deleted because it is linked to pipeline or shortlist history',
            );
        }

        await Candidate.findByIdAndDelete(candidateId);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/candidates/seed
 * Dev-only route — bulk-creates mock candidates with embeddings.
 * Protected: requires admin role in production.
 */
router.post('/seed', async (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Seeding disabled in production' });
    }
    try {
        const { count = 20 } = req.body;
        const { seedMockCandidates } = await import('../../scripts/seedCandidates.js');
        const inserted = await seedMockCandidates(count);
        res.json({ message: `Seeded ${inserted} candidates` });
    } catch (err) {
        next(err);
    }
});

export default router;