# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auto-Ignite Insights is a call center AI insights application. It processes call recordings and transcriptions through multiple LLM providers (OpenAI, Anthropic, Google Gemini, Grok/xAI) to extract narratives and generate summaries. The app includes JWT + 2FA authentication.

## Architecture

**Full-stack TypeScript monorepo** with two independent sub-projects:

- `backend/` — NestJS 11 REST API on port **3007**, connected to **MSSQL** via TypeORM
- `frontend/` — Vue 3 + Vite SPA on port **8080**, proxying `/uiapi/` and `/health` to the backend

### Backend Modules (`backend/src/`)

| Module | Purpose |
|--------|---------|
| `modules/auth/` | Login, JWT, Passport strategies |
| `modules/user/` | User management, 2FA setup, password reset |
| `insights/` | Multi-provider AI insight/narrative extraction (factory pattern) |
| `transcription/` | Transcription processing |
| `recordings/` | Call recording management |
| `infrastructure/` | Shared services (2FA via otplib, QR code generation) |
| `db/entities/` | TypeORM entities: `CallRecording`, `CallTranscript`, `CallInsight`, `InsightSummary`, `UserAccount` |

AI provider selection is driven by `AI_PROVIDER` and `INSIGHTS_PROVIDER` env vars. The insights module uses a factory pattern to swap between OpenAI, Anthropic, Gemini, and xAI.

### Frontend Structure (`frontend/src/`)

App.vue manages a boot → login → 2FA → main shell flow. The main shell is a tabbed interface:
- **Test Lab** — ad-hoc testing
- **Data Queue** — incoming data management
- **Batch Dashboard** — batch processing status
- **Summary** — aggregated insights dashboard
- **Settings** — user/app configuration

State management uses Vue 3 Composition API composables (`useAuth`, `useAccess`). No Pinia/Vuex. API calls go through services in `services/`.

## Development Commands

All commands must be run from within the respective sub-directory.

### Backend

```bash
cd backend
npm run start:dev      # dev server with watch (port 3007)
npm run build          # compile to dist/
npm run start:prod     # run compiled output
npm run lint           # ESLint with auto-fix
npm run format         # Prettier
npm run test           # unit tests (Jest)
npm run test:watch     # unit tests in watch mode
npm run test:cov       # coverage report
npm run test:e2e       # end-to-end tests
```

Run a single test file:
```bash
cd backend
npx jest src/path/to/file.spec.ts
```

### Frontend

```bash
cd frontend
npm run dev            # Vite dev server (port 8080)
npm run build          # tsc check + Vite production build
npm run preview        # preview production build
```

## Environment Configuration

Backend requires `backend/.env`. Key variables:

```
# AI Providers
AI_PROVIDER=openai             # openai | anthropic | gemini | xai
INSIGHTS_PROVIDER=openai
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
XAI_API_KEY=...
DEEPGRAM_API_KEY=...           # transcription

# Database (MSSQL)
DATABASE_HOST=127.0.0.1
DATABASE_PORT=1433
DATABASE_NAME=ai_assist
DATABASE_USER=...
DATABASE_PASSWORD=...

# App
PORT=3007
JWT_SECRET=...
NODE_ENV=development
```

Frontend dev server reads `API_BASE_URL` env var to override the proxy target (default: `http://localhost:3007`).

## Key Conventions

- Backend uses `class-validator` with `whitelist: true, forbidNonWhitelisted: true` globally — all DTOs must have validation decorators.
- TypeORM entities extend `base.entity.ts` for common fields.
- ESLint is configured with `@typescript-eslint/no-explicit-any: off` — `any` types are acceptable.
- Frontend uses `@` as an alias for `src/`.
- Prettier `endOfLine: auto` is enforced in the backend — don't force LF on Windows.
