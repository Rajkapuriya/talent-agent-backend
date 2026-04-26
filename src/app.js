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
    const allowedOrigins = [
  "https://talent-agent-frontend.vercel.app","https://talent-agent-frontend-git-main-raj-kapuriyas-projects.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || origin.includes("vercel.app")) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
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