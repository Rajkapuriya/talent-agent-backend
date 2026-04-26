/**
 * Seeds the MongoDB database with mock candidates for development.
 * Each candidate gets a real embedding from OpenAI.
 *
 * Run: npm run seed
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Candidate from '../src/models/Candidate.js';
import { getEmbedding } from '../src/utils/embedding.util.js';

// -------------------- BASE STATIC DATA --------------------
const MOCK_CANDIDATES = [
    {
        name: 'Priya Mehta',
        headline: 'Senior Frontend Engineer — React, TypeScript, Performance',
        currentRole: 'Senior Frontend Engineer at Razorpay',
        yearsExperience: 6,
        skills: ['react', 'typescript', 'javascript', 'next.js', 'graphql', 'tailwind css', 'jest', 'webpack'],
        education: 'B.Tech Computer Science — IIT Bombay',
        location: 'Bengaluru, India',
        remoteOpen: true,
        employmentTypePreference: 'full-time',
        lastActiveDaysAgo: 3,
        availabilitySignal: 'actively_looking',
        summary: 'Frontend specialist with 6 years of React experience. Led performance optimisation at Razorpay reducing LCP by 40%.',
        seniorityLevel: 'senior',
    },
    // (keep your existing 8 entries unchanged)
];

// -------------------- GENERATOR --------------------
const firstNames = ['Amit', 'Neha', 'Rahul', 'Karan', 'Sneha', 'Vikram', 'Anjali', 'Rohit', 'Pooja', 'Arjun'];
const lastNames = ['Sharma', 'Patel', 'Mehta', 'Gupta', 'Jain', 'Kapoor', 'Reddy', 'Nair', 'Iyer', 'Bansal'];

const roles = [
    'Frontend Engineer',
    'Backend Engineer',
    'Full Stack Developer',
    'MERN Developer',
    'Machine Learning Engineer',
    'Data Engineer'
];

const companies = [
    'Razorpay', 'Flipkart', 'Amazon', 'Google', 'Swiggy', 'Zomato', 'Paytm', 'Zoho'
];

const skillsPool = [
    'react', 'node.js', 'mongodb', 'express', 'typescript', 'javascript',
    'next.js', 'graphql', 'docker', 'aws', 'python', 'sql', 'redis'
];

const locations = [
    'Bengaluru, India', 'Mumbai, India', 'Delhi, India',
    'Hyderabad, India', 'Pune, India', 'Ahmedabad, India'
];

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomSkills() {
    return skillsPool.sort(() => 0.5 - Math.random()).slice(0, 6);
}

function generateCandidate(i) {
    const first = randomItem(firstNames);
    const last = randomItem(lastNames);
    const role = randomItem(roles);
    const company = randomItem(companies);
    const exp = Math.floor(Math.random() * 8) + 1;

    return {
        name: `${first} ${last} `,
        headline: `${role} — Scalable Systems, High Performance`,
        currentRole: `${role} at ${company}`,
        yearsExperience: exp,
        skills: randomSkills(),
        education: 'B.Tech Computer Science',
        location: randomItem(locations),
        remoteOpen: Math.random() > 0.3,
        employmentTypePreference: 'full-time',
        lastActiveDaysAgo: Math.floor(Math.random() * 15),
        availabilitySignal: Math.random() > 0.5 ? 'actively_looking' : 'open',
        summary: `${role} with ${exp} years of experience building scalable applications and distributed systems.`,
        seniorityLevel:
            exp <= 2 ? 'junior' :
                exp <= 5 ? 'mid' : 'senior',
    };
}

function generateBulkCandidates(count = 10) {
    return Array.from({ length: count }, (_, i) => generateCandidate(i));
}

// -------------------- SEED FUNCTION --------------------
export async function seedMockCandidates(total = 10) {
    let inserted = 0;

    // Merge static + generated
    const dynamicCandidates = generateBulkCandidates(total - MOCK_CANDIDATES.length);
    const allCandidates = [...MOCK_CANDIDATES, ...dynamicCandidates];

    for (const c of allCandidates) {
        const existing = await Candidate.findOne({
            name: c.name,
            currentRole: c.currentRole
        });

        if (existing) {
            console.log(`[Seed] Skipping existing: ${c.name}`);
            continue;
        }

        const embeddingText = [
            c.name,
            c.headline,
            c.currentRole,
            `${c.yearsExperience} years`,
            c.skills.join(', '),
            c.summary
        ].join('. ');

        const profileEmbedding = await getEmbedding(embeddingText);

        await Candidate.create({ ...c, profileEmbedding });

        console.log(`[Seed] Created: ${c.name}`);
        inserted++;
    }

    return inserted;
}

// -------------------- RUN --------------------
if (process.argv[1].includes('seedCandidates')) {
    await connectDB();
    const n = await seedMockCandidates(10);
    console.log(`[Seed] Done. ${n} candidates inserted.`);
    await disconnectDB();
    process.exit(0);
}