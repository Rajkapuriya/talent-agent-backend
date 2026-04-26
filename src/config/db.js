import mongoose from 'mongoose';

export async function connectDB() {
    try {
        mongoose.set('strictQuery', true);

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        console.log(`[DB] Connected to MongoDB: ${mongoose.connection.host}`);

        mongoose.connection.on('error', err => {
            console.error('[DB] Connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('[DB] Disconnected. Attempting reconnect...');
        });

    } catch (err) {
        console.error('[DB] Initial connection failed:', err.message);
        process.exit(1);
    }
}

export function disconnectDB() {
    return mongoose.connection.close();
}