# Step 1 — Project Setup & Database

**Project phase:** Step 1 — Setup. **Status:** Completed. **Commit prefix:** `step-1:`.

## Objective

Create a reproducible Next.js + NestJS + PostgreSQL/PostGIS application. A fresh checkout must run with `docker compose up`, and `GET /health` must query the real DB/PostGIS installation. Do **not** implement data import, site/survey CRUD, authentication or map UI yet.

## Requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S1-01 | `docker-compose.yml` contains exactly the three core services `db`, `api`, `web`; `db` has a persistent named volume | REQUIRED |
| S1-02 | Healthchecks and dependency/readiness management | REQUIRED |
| S1-03 | PostgreSQL with PostGIS extension | REQUIRED |
| S1-04 | Schema created through versioned migrations; no `synchronize: true` / runtime schema push | REQUIRED |
| S1-05 | `GET /health` HTTP 200 with `{ "db": "ok", "postgis": "3.x" }`; query DB directly and emit actual 3.x version | REQUIRED |
| S1-06 | `.env.example`; real passwords and `.env` excluded from Git | REQUIRED |
| S1-07 | Restart preserves DB rows; fresh startup ready within 5 min excluding first image downloads | REQUIRED |
| S1-08 | Next.js and NestJS as independent applications, separate npm lockfiles, Drizzle + SQL migrations, TypeScript | DECISION |

## Target repository

```text
gis-seagrass/
  specs/
  frontend/
    src/app/
    package.json
    package-lock.json
    tsconfig.json
    Dockerfile
    .dockerignore
  backend/
    src/main.ts
    src/app.module.ts
    src/health/
    src/database/schema/
    src/database/migrations/
    drizzle.config.ts
    package.json
    package-lock.json
    tsconfig.json
    Dockerfile
    .dockerignore
  seed-data/             # supplied files; not yet imported
  docker-compose.yml
  .env.example
  .gitignore
  README.md
  DESIGN.md
```

The project is a **single Git repository with two independent applications**, not a workspace. `frontend/` and `backend/` each have their own `package.json`, `package-lock.json`, and `node_modules` lifecycle. Do not create a root package manager manifest, workspace config, Turborepo, or shared library packages. Run package commands from the relevant application folder. Docker Compose is the root-level orchestration entrypoint.

Avoid creating empty feature modules merely to imitate architecture. Add them as needed in later Steps.

## Database logical schema to create with migrations

- `users`: UUID PK, unique email, password hash, role (`viewer|editor|admin`), created_at, updated_at.
- `provinces`: `code varchar(2)` PK, `name_th`, `geom geometry(MultiPolygon,4326)`.
- `species`: `code` PK, `name_th`, `name_sci`.
- `sites`: bigint identity PK, `code`, `name`, `province_code` FK, `geom geometry(MultiPolygon,4326)`, `area_rai numeric(14,2)`, `version integer DEFAULT 1`, nullable created_by/updated_by FKs, timestamps, nullable `deleted_at`.
- `surveys`: bigint identity PK, `site_id` FK, nullable `survey_ref`, `geom geometry(Point,4326)`, `surveyed_on date`, `cover_percent numeric(5,2)`, nullable `note`, optional nullable `photo_key`, nullable created_by/updated_by FKs, timestamps.
- `survey_species`: composite PK `(survey_id, species_code)` with FKs to surveys and species. `[DECISION]` API will still expose a `species: string[]` array in Step 4.

Constraints and indexes:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Apply after creating tables in a versioned migration.
CREATE UNIQUE INDEX uq_sites_active_code ON sites(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_surveys_ref ON surveys(survey_ref) WHERE survey_ref IS NOT NULL;
CREATE INDEX idx_provinces_geom ON provinces USING GIST(geom);
CREATE INDEX idx_sites_geom ON sites USING GIST(geom);
CREATE INDEX idx_surveys_geom ON surveys USING GIST(geom);
CREATE INDEX idx_surveys_site_date ON surveys(site_id, surveyed_on DESC, id DESC);
```

Additionally add checks for `users.role`, `sites.version > 0` and `surveys.cover_percent BETWEEN 0 AND 100`. Keep geometry SRID/type enforced at the database type level. Use FK restrictions that preserve referenced data (no cascade from sites to surveys). A migration should be repeatable through the migration runner, not by blindly reapplying DDL.

**Note:** `created_by` and `updated_by` nullable accommodates imported records in Step 2; actual authenticated user attribution starts in Step 5. `province_code` and `area_rai` become server-derived values in Step 2/3.

## Docker startup design

1. `db` starts using a pinned-compatible PostGIS image; healthcheck uses `pg_isready`; data stored in a named volume.
2. `api` waits for a healthy DB, then executes migrations **before** starting its NestJS HTTP listener. Migration errors fail startup. In this Step no importer is run.
3. `web` starts Next.js; the start page may be a simple placeholder displaying system name. Web health/readiness check must be a real HTTP check, not just checking a running process.
4. Use multi-stage Dockerfiles, `.dockerignore`, non-secret environment configuration; expose configurable local development ports. Prefer using Node's built-in HTTP client for image healthchecks rather than assuming curl/wget exists.
5. Step 2 will extend the API startup preflight to `migrate → import → serve`, **without adding an extra permanent Compose service**.

Do not put `localhost` in `DATABASE_URL` for API-container-to-DB connections: use Docker host `db`. Keep browser-facing API base URL distinct from internal service URLs. The Docker build context for `api` is `./backend` and for `web` is `./frontend`; no workspace-root dependency installation.

## Health endpoint contract

`GET /health` → HTTP 200; JSON object with exactly the required keys `db` and `postgis`. Execute SQL such as `SELECT PostGIS_Version()` or `SELECT PostGIS_Lib_Version()` through the DB connection and return its actual detected version. If DB/PostGIS query fails, return an unhealthy error (e.g. 503); never return a hard-coded success.

## Tests / verification

- `docker compose config` succeeds with documented development `.env`.
- `cd frontend && npm ci` and `cd backend && npm ci` work independently; neither needs a root package manifest.
- Fresh volume: `docker compose up --build` initializes schema and all services become healthy.
- `GET /health` returns 200 and version from real PostGIS query.
- Check existence of all six tables, FK/check constraints and GiST/unique indexes with SQL/catalog queries.
- Running migrations again is safe; no duplicate DDL.
- Create a temporary test row, restart Compose services **without deleting volumes**, verify it persists; clean test row afterward.
- Stop DB and verify API no longer reports healthy.
- Verify no actual secrets or `.env` are tracked.

## Definition of done

- [x] `frontend/` and `backend/` build independently, with their own manifests/lockfiles.
- [x] Three services healthy and fresh setup reproducible with `docker compose up`.
- [x] Migration completed before API accepts traffic.
- [x] `/health` queries live database and PostGIS.
- [x] Schema, constraints and spatial indexes exist.
- [x] Restart retains data.
- [x] `.env.example`, startup/test instructions and limitations documented.
- [x] Tests and verification commands executed successfully.
- [x] Move the Next.js app to the specified `frontend/src/app/` layout.
- [x] Add the specified `backend/drizzle.config.ts`.

## Git instructions for this Step

1. Keep changes scoped to Step 1; do not run Step 2 import yet.
2. Review working tree, staged diff and ignored secrets.
3. Commit after tests using e.g. `git commit -m "step-1: initialize project and PostGIS database"`.
4. Report the commit hash and test results. Stop and wait for the user to explicitly request Step 2.
