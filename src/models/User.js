import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['recruiter', 'admin'], default: 'recruiter' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
}, { timestamps: true });

// Hash password before save
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare plain-text password to hash
UserSchema.methods.comparePassword = function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

// Strip password from JSON output
UserSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

export default mongoose.model('User', UserSchema);