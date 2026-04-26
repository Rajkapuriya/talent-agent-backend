import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Validates JWT from Authorization: Bearer <token> header.
 * Attaches req.user = { id, email, role } on success.
 */
export async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    const headerToken = header?.startsWith('Bearer ') ? header.split(' ')[1] : null;
    // EventSource cannot set custom headers, so allow query token for SSE routes.
    const queryToken = typeof req.query?.token === 'string' ? req.query.token : null;
    const token = headerToken ?? queryToken;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Light DB check — confirms user still exists and is active
        const user = await User.findById(decoded.id).select('_id email role isActive');
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User not found or deactivated' });
        }

        req.user = { id: user._id.toString(), email: user.email, role: user.role };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

/**
 * Requires the authenticated user to have the 'admin' role.
 * Must be used after authenticate().
 */
export function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

/**
 * Signs a JWT for a given user document.
 * @param {mongoose.Document} user
 * @returns {string} signed JWT
 */
export function signToken(user) {
    return jwt.sign(
        { id: user._id.toString(), email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
    );
}