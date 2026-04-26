import mongoose from 'mongoose';

const MatchResultSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    matchScore: { type: Number, min: 0, max: 100 },
    skillsCoverage: Number,
    seniorityAlignment: Number,
    experienceDepth: Number,
    domainRelevance: Number,
    preferredBonus: Number,
    matchExplanation: String,
    topStrengths: [String],
    skillGaps: [String],
    dealBreakerFlags: [String],
    suppressed: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('MatchResult', MatchResultSchema);