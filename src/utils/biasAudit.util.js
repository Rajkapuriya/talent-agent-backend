const PROTECTED_PATTERNS = [
    /\bmale\b|\bfemale\b|\bman\b|\bwoman\b|\bgender\b/i,
    /\bage\b|\byears old\b|\by\/o\b/i,
    /\bmarried\b|\bsingle\b|\bmother\b|\bfather\b/i,
    /\bnationality\b|\bethnicity\b|\brace\b|\breligion\b/i,
];

const DISCRIMINATION_PATTERNS = [
    /\b(prefer|only|must|reject|exclude|not suitable|filter out|shortlist)\b.{0,40}\b(location|located in|based in|city|country|region)\b/i,
    /\b(location|located in|based in|city|country|region)\b.{0,40}\b(prefer|only|must|reject|exclude|not suitable|filter out|shortlist)\b/i,
];

export function runBiasAudit(entries, aggregateInsights) {
    const findings = [];
    const checkText = (source, text) => {
        if (typeof text !== 'string' || !text.trim()) return;
        if (PROTECTED_PATTERNS.some((regex) => regex.test(text)) || DISCRIMINATION_PATTERNS.some((regex) => regex.test(text))) {
            findings.push(source);
        }
    };

    for (const entry of entries ?? []) {
        checkText(`entry:${entry.candidateId}:scoreCard`, entry.scoreCard);
        checkText(`entry:${entry.candidateId}:matchExplanation`, entry.matchResult?.matchExplanation);
        checkText(`entry:${entry.candidateId}:interestSummary`, entry.interestResult?.interestSummary);
    }

    checkText('aggregate:commonGap', aggregateInsights?.commonGap);
    checkText('aggregate:jdCalibrationNote', aggregateInsights?.jdCalibrationNote);
    checkText('aggregate:topRecommendation:reason', aggregateInsights?.topRecommendation?.reason);

    return {
        passed: findings.length === 0,
        findings,
    };
}
