import mongoose from 'mongoose';

const StructuredJDSchema = new mongoose.Schema({
    jobTitle: { type: String, required: true },
    seniorityLevel: { type: String, enum: ['junior', 'mid', 'senior', 'staff', 'principal', 'director', 'vp'] },
    domain: String,
    requiredSkills: [String],
    preferredSkills: [String],
    yearsExperienceMin: Number,
    yearsExperienceMax: Number,
    educationRequirement: String,
    employmentType: String,
    remotePolicy: String,
    industry: String,
    keyResponsibilities: [String],
    screeningQuestions: [String],
    dealBreakers: [String],
    parseQuality: { type: Number, min: 0, max: 1 },
    // Embeddings stored as flat arrays — Atlas Vector Search indexes these
    jdSkillEmbedding: { type: [Number], default: undefined },
    jdContextEmbedding: { type: [Number], default: undefined },
}, { _id: false });

const JobSchema = new mongoose.Schema({
    rawJd: { type: String, required: true },
    structured: StructuredJDSchema,
    status: { type: String, enum: ['draft', 'parsed', 'running', 'complete', 'error'], default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pipelineRunId: String,
}, { timestamps: true });

export default mongoose.model('Job', JobSchema);