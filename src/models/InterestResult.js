import mongoose from 'mongoose';

const TurnSchema = new mongoose.Schema({
    role: { type: String, enum: ['recruiter', 'candidate'] },
    content: String,
    signalAnnotation: {
        signalType: { type: String, enum: ['positive', 'negative', 'neutral', 'ambiguous'] },
        signalCategory: { type: String, enum: ['interest', 'availability', 'motivation', 'concern', 'engagement'] },
        confidence: Number,
    },
}, { _id: false });

const InterestResultSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    interestScore: { type: Number, min: 0, max: 100 },
    interestDimensionScores: {
        interest: Number,
        motivation: Number,
        availability: Number,
        engagement: Number,
        concern: Number,
    },
    signalReliability: { type: String, enum: ['HIGH', 'LOW'], default: 'HIGH' },
    conversationTranscript: [TurnSchema],
    interestSummary: String,
    availabilityFlag: { type: String, enum: ['ready_now', '1-month', '2-months', 'unclear'] },
    concernFlags: [String],
    recommendedNextAction: String,
}, { timestamps: true });

export default mongoose.model('InterestResult', InterestResultSchema);