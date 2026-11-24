# Repository Guidelines

## Project Overview

Seagrass Monitoring System: a PostGIS-backed API and web map for sites, surveys, and survey history. `backend/` and `frontend/` are separate npm projects; Docker Compose runs them with the database.

## Architecture & Data Flow

- `backend/src/main.ts` starts NestJS after checking JWT configuration, running migrations, and importing seed data. Controllers validate requests, application services enforce use cases, and Drizzle repositories read/write PostgreSQL/PostGIS.
- `backend/src/app.module.ts` wires auth, sites, surveys, and platform providers; `main.ts` runs imports at startup. `site-survey-workflows/` coordinates site/survey writes in shared transactions; site and survey queries stay separate from write commands.
- `frontend/src/app/page.tsx` renders the site workspace under auth. Browser calls from `frontend/src/lib/api.ts` pass through `app/api/[...path]/route.ts` and `lib/api-proxy.ts` to the backend. Features own UI, state, and data fetching.

## Key Directories

- `backend/src/{auth,sites,surveys,import}/`: API features and seed-data import; `site-survey-workflows/`: cross-feature transactions.
- `backend/src/platform/`: database schema/provider, HTTP, errors, health; `backend/src/shared/`: shared input, application, and geospatial code.
- `frontend/src/app/`: Next.js routes/providers; `frontend/src/features/`: auth, map, sites, surveys, provinces; `frontend/src/lib/`: API client/proxy.
- `backend/tests/{auth,import,platform,sites,surveys}/`: module-grouped Vitest specs, fixture helpers, and standalone SQL schema check; `frontend/src/**/*.test.ts`: colocated frontend tests. `specs/`, `.scratch/`, `docs/adr/`: implementation specs, local issues, decisions.

## Development Commands

Install separately with `npm --prefix backend ci` and `npm --prefix frontend ci`; there is no root package script.

| Task | Command |
| --- | --- |
| Start stack | `cp .env.example .env` then `docker compose up --build --wait -d` |
| Run frontend locally | `npm --prefix frontend run dev` |
| Build | `npm --prefix backend run build`; `npm --prefix frontend run build` |
| Test | `npm --prefix backend test`; `npm --prefix frontend test` |
| Lint frontend | `npm --prefix frontend run lint` |
| Migrate/import in Compose | `docker compose exec api npm run migrate`; `docker compose exec api npm run import` |

## Code Conventions & Common Patterns

- Backend uses Nest module/provider injection; application-layer repository ports have Drizzle implementations in each feature's `infrastructure/`. Keep database transactions in the site/survey coordinator, not controllers.
- Throw `ApplicationError` for use-case failures; `backend/src/platform/errors/error.filter.ts` maps errors to HTTP responses. Follow the flat `domain/`, `application/`, `infrastructure/`, `presentation/` naming in `docs/adr/0002-flat-clean-architecture-naming.md`.
- Frontend uses Zustand for auth/workspace state and TanStack Query for server data. Follow feature-local controllers' request cancellation/stale-response handling; API failures use `ApiClientError`.
- For domain terms or changes, read `GLOSSARY.md` and relevant `docs/adr/` records; follow `docs/agents/domain.md`.
- Issues and specs live under `.scratch/`: see `docs/agents/issue-tracker.md`. Use canonical triage roles from `docs/agents/triage-labels.md`.
- For any Step task, read `specs/README.md` first, then that Step's spec. Follow its completion criteria and `step-N:` commit prefix.

## Important Files

- Backend entry/composition: `backend/src/main.ts`, `backend/src/app.module.ts`; schema: `backend/src/platform/database/schema/index.ts`; cross-feature writes: `backend/src/site-survey-workflows/application/site-survey-coordinator.ts`.
- Frontend entry/API: `frontend/src/app/page.tsx`, `frontend/src/app/api/[...path]/route.ts`, `frontend/src/lib/api.ts`; main UI: `frontend/src/features/sites/components/SitesWorkspace.tsx`.
- `README.md` documents setup and operations; `DESIGN.md` records system constraints; `specs/README.md` tracks implemented versus planned Steps.

## Runtime/Tooling Preferences

- Both Dockerfiles use Node.js 22 Alpine; local Node version is not pinned. Use npm and each project's `package-lock.json`; both TypeScript configs enable `strict`.
- Compose provides PostGIS 16. Host ports default to DB `5432`, API `3000`, web `3001`, bound to `127.0.0.1`; configure through `.env.example`. Set `JWT_SECRET` before startup; never commit `.env`.
- Before frontend edits, read `frontend/AGENTS.md` and the installed Next.js guide it names. Backend has no lint script; frontend lint uses Oxlint.

## Testing & QA

- Backend `npm test` builds for subprocess checks, type-checks `tests/**/*.ts` without emitting, then runs serial Vitest `tests/**/*.spec.ts` suites with Nest decorator metadata and `expect` assertions. Database integration tests need `IMPORT_TEST_DATABASE_URL` pointing at a disposable PostGIS DB: they migrate and mutate fixtures. Parser tests work without it. Backend architecture rules are guidance in `DESIGN.md` and ADR-0002, not a test-enforced boundary.
- Frontend `npm test` runs Vitest on `src/**/*.test.ts`; tests live beside features. No coverage threshold or coverage command is configured. Run the narrowest relevant check for a change.
