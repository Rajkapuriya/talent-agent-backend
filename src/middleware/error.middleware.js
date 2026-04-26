/**
 * Global Express error handler.
 * Must be registered as the LAST middleware in app.js.
 * Catches any error passed to next(err).
 */
export function errorHandler(err, req, res, _next) {
    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({ error: 'Validation failed', details: messages });
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        return res.status(409).json({ error: `${field} already exists` });
    }

    // Mongoose cast error (bad ObjectId)
    if (err.name === 'CastError') {
        return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
    }

    // Custom app errors with a status code
    if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    // Log unexpected errors (don't expose details in production)
    console.error('[Unhandled Error]', err);

    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
}

/**
 * Creates an error with a specific HTTP status code.
 * Use: throw createError(404, 'Job not found')
 */
export function createError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}