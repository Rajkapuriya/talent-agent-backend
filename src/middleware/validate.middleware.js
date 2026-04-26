/**
 * Validates req.body against a Zod schema.
 * Returns 400 with structured errors on failure.
 * Usage: router.post('/route', validate(MySchema), handler)
 *
 * @param {import('zod').ZodSchema} schema
 */
export function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message,
            }));
            return res.status(400).json({ error: 'Validation failed', details: errors });
        }
        req.validatedBody = result.data;
        next();
    };
}