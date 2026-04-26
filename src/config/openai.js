import OpenAI from 'openai';

// Singleton — one client shared across all services
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    timeout: 60_000,        // 60s per call
    maxRetries: 2,          // Retry transient errors
});

if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error('Missing API key: set GROQ_API_KEY (preferred) or OPENAI_API_KEY.');
}

export default openai;