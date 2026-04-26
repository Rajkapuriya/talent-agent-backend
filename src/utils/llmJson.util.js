export function safeParseJson(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('EMPTY_JSON_PAYLOAD');

    try {
        return JSON.parse(text);
    } catch {
        // continue to repair strategies
    }

    const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        // continue to extraction strategies
    }

    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            // continue to final attempt
        }
    }

    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch {
            // fall through
        }
    }

    throw new Error('UNPARSEABLE_JSON_PAYLOAD');
}
