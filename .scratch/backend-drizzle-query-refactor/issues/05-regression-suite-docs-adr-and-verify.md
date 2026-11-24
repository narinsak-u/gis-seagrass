# 05: Full regression suite, DESIGN.md & ADR-0003 documentation, and independent verification

**What to build:** Validate the complete refactor against disposable PostGIS, inspect generated SQL and `git diff`, document the Drizzle-first query policy and raw-SQL exceptions in `DESIGN.md` and `docs/adr/0003-drizzle-first-query-policy.md`, and complete independent verification before committing with `refactor:`.

**Blocked by:** 04

**Status:** ready-for-agent

- [x] Run `npm --prefix backend run build` and full `npm --prefix backend test` against an isolated disposable PostGIS database; verify zero skipped/relaxed assertions and clean fixture teardown.
- [x] Inspect `git diff` and generated SQL / parameterization across R1–R7, and manually check Clean Architecture boundaries against `DESIGN.md` and ADR-0002 (no NestJS/Drizzle/`pg` imports in `domain/` or `application/`, no schema/migration/API contract changes).
- [x] Update `DESIGN.md` and add `docs/adr/0003-drizzle-first-query-policy.md` documenting the Drizzle-first query policy and every retained raw-SQL exception.
- [ ] Run `/verify` against the confirmed spec, tickets, ADRs, code, and test evidence, resolve any findings, and commit scope-relevant files with `refactor:` prefix.

## Comments

### Audit, Documentation & Full Regression Evidence

- **Branch / Base commit:** `ticket/05-docs-adr-and-regression` branched from `refactor/backend-drizzle-query-policy` (`75dba80`).
- **Raw SQL (`.execute` / `pool.query` / `client.query`) audit across `backend/src/`:**
  - **In-scope (R1–R7):** `1` remaining `.execute` call (down from `23`): `backend/src/sites/infrastructure/drizzle-site-write.repository.ts:162` (`deriveSiteSpatial()`, 4-stage `WITH ... MATERIALIZED` PostGIS CTE with inline rationale comment at line 160).
  - **Untouched out-of-scope (3 files, 4 calls):**
    - `backend/src/import/infrastructure/reference-data.ts:32` (`db.execute`, reference province GeoJSON validation)
    - `backend/src/import/infrastructure/advisory-lock.ts:9,13` (`client.query`, pinned-client `pg_advisory_lock`/`pg_advisory_unlock`)
    - `backend/src/platform/health/health.controller.ts:16` (`pool.query`, `SELECT PostGIS_Lib_Version() AS version`)
  - **Parameterization:** `0` `sql.raw` calls and `0` string-concatenated SQL statements across `backend/src/`; all queries use Drizzle query builder APIs or parameterized `sql` templates with schema column references.
- **Clean Architecture & scope audit (`git diff main..HEAD -- backend/src/`):**
  - `0` `@nestjs`, `drizzle-orm`, `pg`, `presentation`, or `infrastructure` imports in any `domain/` or `application/` layer.
  - Flat four-layer structure (`domain`, `application`, `infrastructure`, `presentation`) preserved with zero retired nested subfolders; `backend/src/surveys/infrastructure/latest-cover-percentages.ts` stays private to `surveys/infrastructure/`.
  - `0` changes to database schema, migrations, seed data, HTTP controllers/DTOs/OpenAPI, or `frontend/` (`8` files changed under `backend/src/{sites,surveys}/infrastructure/`, `4` test files under `backend/tests/{sites,surveys}/`).
- **Documentation & ADR:**
  - Updated `DESIGN.md` (`## Backend architecture`) to link `[ADR-0003](docs/adr/0003-drizzle-first-query-policy.md)` and document the Drizzle-first query policy, shared `latest-cover-percentages.ts` helper, and retained raw-SQL exceptions.
  - Added `docs/adr/0003-drizzle-first-query-policy.md` (`status: accepted`) covering the Drizzle-first default, targeted `sql<T>` PostGIS/cast expressions, literal-substring `strpos` predicate, shared CTE helper, retained exceptions, Considered Options, and Consequences.
- **Build & full regression suite (disposable PostGIS `postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test`):**
  - `npm --prefix backend run build`: exited `0`.
  - `IMPORT_TEST_DATABASE_URL=postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test npm --prefix backend test` (includes `build`, `typecheck:tests`, and serial `vitest run`): exited `0` — **25 passed (25) test files, 81 passed (81) tests** (`0` failed, `0` skipped; `19` integration files / `75` tests + `6` unit files / `6` tests; duration `30.03s`).
