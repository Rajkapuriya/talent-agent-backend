import 'dotenv/config';
import { validateEnv } from './src/config/env.js';
import { connectDB } from './src/config/db.js';
import { createApp } from './src/app.js';

// Crash immediately if required env vars are missing
validateEnv();

const PORT = process.env.PORT ?? 5000;

async function bootstrap() {
    await connectDB();

    const app = createApp();

    app.listen(PORT, () => {
        console.log(`[Server] Running on http://localhost:${PORT} (${process.env.NODE_ENV})`);
    });
}

bootstrap().catch(err => {
    console.error('[Bootstrap Error]', err);
    process.exit(1);
});