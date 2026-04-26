import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/auth.routes.js';
import jobRoutes from './routes/jobs.routes.js';
import candidateRoutes from './routes/candidates.routes.js';
import pipelineRoutes from './routes/pipeline.routes.js';
import shortlistRoutes from './routes/shortlist.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export function createApp() {
    const app = express();

    // Security + parsing
    app.use(helmet());
    app.use(cors({
        origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
        credentials: true,
    }));
    app.use(express.json({ limit: '2mb' }));
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

    // Health check (no auth required)
    app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

    // API routes
    app.use('/api/auth', authRoutes);
    app.use('/api/jobs', jobRoutes);
    app.use('/api/candidates', candidateRoutes);
    app.use('/api/pipeline', pipelineRoutes);
    app.use('/api/shortlists', shortlistRoutes);

    // 404 catch-all
    app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

    // Global error handler — must be last
    app.use(errorHandler);

    return app;
}