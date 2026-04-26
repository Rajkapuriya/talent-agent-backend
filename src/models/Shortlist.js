import mongoose from 'mongoose';

const ShortlistEntrySchema = new mongoose.Schema({
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
    matchResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'MatchResult' },
    interestResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'InterestResult' },
    matchScore: Number,
    interestScore: Number,
    combinedScore: Number,
    tier: { type: String, enum: ['tier1', 'tier2', 'tier3', 'archive'] },
    scoreCard: String,   // LLM-generated 4-sentence brief
    rank: Number,
}, { _id: false });

const ShortlistSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    entries: [ShortlistEntrySchema],
    aggregateInsights: {
        commonGap: String,
        jdCalibrationNote: String,
        topRecommendation: mongoose.Schema.Types.Mixed,
    },
    generatedAt: Date,
}, { timestamps: true });

export default mongoose.model('Shortlist', ShortlistSchema);