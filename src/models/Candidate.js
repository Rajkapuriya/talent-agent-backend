import mongoose from 'mongoose';

const CandidateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    headline: String,
    currentRole: String,
    yearsExperience: { type: Number, required: true },
    skills: [String],
    education: String,
    location: String,
    remoteOpen: Boolean,
    employmentTypePreference: String,
    lastActiveDaysAgo: Number,
    availabilitySignal: { type: String, enum: ['actively_looking', 'open', 'not_looking'] },
    summary: String,
    seniorityLevel: String,
    // Pre-computed at ingestion time
    profileEmbedding: { type: [Number], default: undefined },
}, { timestamps: true });

// Atlas Vector Search index must be created separately in Atlas UI or CLI:
// { "fields": [{ "type": "vector", "path": "profileEmbedding", "numDimensions": 1536, "similarity": "cosine" }] }

export default mongoose.model('Candidate', CandidateSchema);