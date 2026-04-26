# Talent Agent Server

Backend service for the Talent Agent platform. It handles authentication, job ingestion, JD parsing, candidate discovery, scoring, simulated outreach, and ranked shortlisting.

## Tech Stack

- Node.js (>=20)
- Express 5
- MongoDB + Mongoose
- OpenAI-compatible SDK client (Groq/OpenAI style endpoints)
- Zod validation

## Core Capabilities

- Recruiter auth (register/login/me)
- Job lifecycle APIs
- Candidate CRUD with embedding generation
- End-to-end shortlist pipeline:
  - JD parsing
  - candidate discovery (Atlas vector search + local fallback)
  - deterministic match scoring
  - conversation-based interest scoring
  - ranking + tiering + scorecards
- Shortlist retrieval + CSV export

## Project Structure

- `index.js` - app bootstrap and startup
- `src/app.js` - middleware + route wiring
- `src/config/` - DB/env/LLM client config
- `src/routes/` - REST and SSE endpoints
- `src/services/` - pipeline domain logic
- `src/models/` - Mongoose schemas
- `src/middleware/` - auth/validation/error handling
- `src/utils/` - embeddings, scoring, bias audit, shared helpers
- `scripts/` - seed/backfill/diagnostic scripts
- `docs/atlas/candidate_profile_vector_index.json` - Atlas vector index template

# Optional override
VECTOR_INDEX_NAME=candidate_profile_vector_index
```

Important:

- Include the DB name in `MONGODB_URI` (`...mongodb.net/<dbName>...`). If omitted, Mongo may use `test`.
- Current `validateEnv()` requires `OPENAI_API_KEY` to be present. If you run fully local embeddings, keep a placeholder value unless you relax validation in `src/config/env.js`.

## Installation

```bash
cd server
npm install
```

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm run start
```

Tests:

```bash
npm run test
```

## NPM Scripts

- `npm run dev` - run with nodemon
- `npm run start` - run with node
- `npm run seed` - seed mock candidates
- `npm run embeddings:backfill` - regenerate candidate embeddings
- `npm run embeddings:diagnose` - diagnose vector search/index health
- `npm run test` - test suite
- `npm run test:watch` - watch mode tests

## API Overview

Base URL: `http://localhost:5000/api`

### Health

- `GET /health` - liveness check

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### Jobs

- `POST /jobs` - create new job from raw JD
- `GET /jobs` - list jobs for current recruiter
- `GET /jobs/:id` - fetch one job
- `PATCH /jobs/:id` - update allowed fields (status)
- `DELETE /jobs/:id` - delete job (+ shortlist cleanup)

### Candidates

- `GET /candidates` - list/filter/paginate
- `GET /candidates/:id` - fetch one
- `POST /candidates` - create (auto-generates embedding)
- `PUT /candidates/:id` - update (re-generates embedding)
- `DELETE /candidates/:id` - delete if not pipeline-linked
- `POST /candidates/seed` - dev-only bulk seed

### Pipeline

- `POST /pipeline/run` - start async run, returns `runId`
- `GET /pipeline/:runId/progress` - SSE stage updates

### Shortlists

- `GET /shortlists/:jobId` - full populated shortlist


## Pipeline Stages

1. Parse JD (`jdParser.service.js`)
2. Discover candidates (`candidateDiscovery.service.js`)
3. Score match (`matchScoring.service.js`)
4. Simulate outreach (`conversationAgent.service.js`)
5. Rank + tier + insights (`ranking.service.js`)


### Candidate Embedding Generation

- Generated on candidate create/update in `candidates.routes.js`
- Embedding text combines name/headline/role/experience/skills/summary

## Security Notes

- Never commit real API keys or DB credentials.
- Rotate secrets if exposed.
- Restrict CORS origins for production.
- Use strong `JWT_SECRET` and secure secret management (vault/provider env manager).

## Deployment Notes

- Set `NODE_ENV=production`
- Provide production `MONGODB_URI` with DB name
- Configure `CLIENT_URL` and/or CORS whitelist in `src/app.js`
- Ensure Atlas vector index is created in production cluster before pipeline runs
