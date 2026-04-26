import express from 'express';
import { z } from 'zod';
import User from '../models/User.js';
import { signToken, authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createError } from '../middleware/error.middleware.js';

const router = express.Router();

const RegisterSchema = z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(100),
});

const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

/**
 * POST /api/auth/register
 * Creates a new recruiter account.
 */
router.post('/register', validate(RegisterSchema), async (req, res, next) => {
    try {
        const { name, email, password } = req.validatedBody;

        const existing = await User.findOne({ email });
        if (existing) throw createError(409, 'Email already registered');

        const user = await User.create({ name, email, password });
        const token = signToken(user);

        res.status(201).json({ token, user });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/auth/login
 * Returns a JWT for valid credentials.
 */
router.post('/login', validate(LoginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.validatedBody;

        const user = await User.findOne({ email }).select('+password');
        if (!user) throw createError(401, 'Invalid email or password');

        const valid = await user.comparePassword(password);
        if (!valid) throw createError(401, 'Invalid email or password');

        user.lastLoginAt = new Date();
        await user.save({ validateBeforeSave: false });

        const token = signToken(user);

        res.json({ token, user: user.toJSON() });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user.
 */
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) throw createError(404, 'User not found');
        res.json({ user });
    } catch (err) {
        next(err);
    }
});

export default router;