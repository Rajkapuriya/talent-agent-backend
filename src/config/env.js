const REQUIRED = [
    'MONGODB_URI',
    'OPENAI_API_KEY',
    'JWT_SECRET',
];

export function validateEnv() {
    const missing = REQUIRED.filter(key => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`[ENV] Missing required environment variables: ${missing.join(', ')}`);
    }
    console.log('[ENV] All required variables present.');
}