# Seagrass Monitoring — Implementation Specs

## Project scope and conventions

These specifications define the implementation plan for the **Seagrass Monitoring System**. `specs/README.md` establishes cross-step conventions, and each step document defines the requirements and acceptance criteria for its feature scope. `[REQUIRED]` means an agreed project requirement; `[DECISION]` means an implementation choice. Record changes and rationale in `DESIGN.md`. Do not claim an unverified feature is finished.

## Roadmap

| File | Scope | Priority | Status |
| --- | --- | --- | --- |
| `step-1-setup.md` | Docker Compose, project, PostGIS, migrations, healthcheck | Required | Detailed |
| `step-2-seed-data.md` | Import, spatial validation, idempotency, report | Required | Detailed |
| `step-3-site-api.md` | Site CRUD, bbox GeoJSON, Swagger | Required | Implemented and verified |
| `step-4-survey-api.md` | Survey CRUD, distance rule, status | Required | Ready for implementation |
| `step-5-auth-concurrency.md` | JWT, RBAC, optimistic locking | Required | Planned |
| `step-6-map-ui.md` | MapLibre map, synchronized list and filters | Required | Planned |
| `step-7-map-editing.md` | Map interactions and editing | Optional | Planned |
| `step-8-dashboard-export.md` | Aggregation, dashboard, exports | Optional | Planned |
| `step-9-production.md` | Production enhancements | Optional | Planned |

Step 3 has an agreed specification at `step-3-site-api.md`. Step 4 now has an implementation-ready specification at `step-4-survey-api.md`, including the agreed Site-status formula. Steps 5–9 remain planned names, not created specs. Do not fabricate acceptance criteria for those later Steps.

## Repository structure and package management

Use a **simple repository with two independent applications**, not a monorepo/workspace:

```text
gis-seagrass/
├── frontend/              # Next.js, own package.json and lockfile
├── backend/               # NestJS, own package.json and lockfile
│   └── seed-data/         # Original source files; do not modify
├── specs/                 # Step-by-step implementation specifications
├── docker-compose.yml
├── .env.example
├── README.md
└── DESIGN.md
```

- `frontend/` and `backend/` each own their dependencies, scripts, TypeScript config, Dockerfile, and package lockfile.
- No `apps/`, root `package.json`, `pnpm-workspace.yaml`, Turborepo or shared workspace packages.
- Use `npm` independently within each app (e.g. `cd backend && npm install`); root Docker Compose coordinates all three services (`db`, `api`, `web`).
- Shared behavior between import and HTTP APIs lives in the **backend's** service/domain code, not a cross-application package.

## Global agent workflow and Git policy

1. Read `specs/README.md` and **only the current Step spec**. Check current Git branch and worktree before changing files.
2. Implement one Step at a time. Make limited changes required for that Step; do not pre-implement later Steps.
3. Run the Step's checks and tests; resolve failures or disclose them explicitly. Before declaring it complete, compare the implementation with the current Step spec, especially every **Definition of done** item. Check off only criteria verified by tests or inspection; leave unmet criteria unchecked and report gaps. Do not mark the Step complete until all required criteria pass.
4. Update root `README.md` to reflect only implemented features, commands and limitations. Keep `DESIGN.md` concise and track architectural decisions and trade-offs.
5. Review `git diff`, check for secrets and ensure source data were not modified. Stage relevant files only, not the entire worktree blindly.
6. **Commit after a completed, verified unit of work**, with the exact prefix `step-N:` (where N is the current Step number). Multiple commits per Step are fine. Examples:
   - `step-1: initialize compose services and database migrations`
   - `step-2: add seed import and validation report`
7. Never commit failing work under a “completed” description; never `git commit --amend`, reset, force-push or overwrite unrelated existing changes unless explicitly asked.
8. After committing, show commit hash, summary of changed files, tests executed and remaining limitations. Stop; **do not begin the next Step automatically**.

## Project deliverables

- Source code and separate `step-N:` commits.
- `docker-compose.yml`, `.env.example`; `docker compose up` must set up the system.
- `/docs` and API request examples when reached in Step 3.
- Unit validation/status tests and integration tests for `OUTSIDE_SITE`, `VERSION_CONFLICT` when reached in Steps 4–5.
- `import_report.csv` from Step 2.
- Root `README.md` with startup, tests, implemented steps and three role credentials when Step 5 is complete.
- Root `DESIGN.md` explaining geometry storage, validation policy, concurrency, scaling approach and known limitations.
