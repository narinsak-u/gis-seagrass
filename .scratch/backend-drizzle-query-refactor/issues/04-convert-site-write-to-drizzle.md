# 04: Convert Site write repository (R6) to Drizzle builder while preserving locking and deriveSiteSpatial

**What to build:** Convert routine create, import, lock, distance, and update queries in `DrizzleSiteWriteRepository` to Drizzle builder while retaining `deriveSiteSpatial()` as a documented raw-SQL exception and preserving `FOR UPDATE` serialization, `DUPLICATE_CODE` translation, and optimistic version increments.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] **R6 (`drizzle-site-write.repository.ts`):** Convert `create`, `import` (`.onConflictDoNothing()`), `lock` (`.for('update')`), `lockForSurvey` (`.for('update')`), `withinDistance`, and both `update` branches (spatial + name-only, with atomic `version: sql\`${sites.version} + 1\``) to Drizzle builder.
- [x] Verify PostgreSQL unique-constraint error translation (`23505` / `uq_sites_code` → `ApplicationError('DUPLICATE_CODE', ...)`) still works through Drizzle's error cause chain.
- [x] Keep `deriveSiteSpatial()` as the documented raw-SQL `WITH ... MATERIALIZED` CTE with a concise rationale comment.
- [x] Confirm `backend` build, Site create/patch/delete/concurrency integration tests, and Site importer tests pass on disposable PostGIS.

## Comments

### Implementation & Verification Evidence

- **Branch / Base commit:** `ticket/04-convert-site-write-to-drizzle` branched from `refactor/backend-drizzle-query-policy` (`993ac7e`).
- **R6 (`backend/src/sites/infrastructure/drizzle-site-write.repository.ts`):**
  - Converted 7 of 8 `.execute` calls (`create`, `import`, `lock`, `lockForSurvey`, `withinDistance`, and both spatial + name-only `update` branches unified into one Drizzle `.update(sites).set(...)`) to Drizzle query builder with parameterized `sql<T>` expressions; `1` `.execute` call remains (`deriveSiteSpatial()`).
  - `create` uses `tx.insert(sites).values(...).returning({ version: sites.version, geometry: sql<SiteFeature['geometry']>\`ST_AsGeoJSON(${sites.geom}, 15)::jsonb\` })` and preserves `23505` / `uq_sites_code` → `ApplicationError('DUPLICATE_CODE', ...)` translation through Drizzle's `error.cause` chain.
  - `import` uses `tx.insert(sites).values({ ..., createdBy: null, updatedBy: null }).onConflictDoNothing().returning({ code: sites.code })`.
  - `lock` and `lockForSurvey` use `.from(sites).where(and(eq(sites.code, code), isNull(sites.deletedAt))).for('update')` with `ST_AsGeoJSON` / `ST_DWithin`; `withinDistance` uses `.from(sites).where(and(eq(sites.id, BigInt(id)), isNull(sites.deletedAt)))`.
  - `update` unifies spatial and name-only branches via `tx.update(sites).set(...)` omitting `name` when `patch.name === undefined` (equivalent to `COALESCE($1, name)`), setting `version: sql\`${sites.version} + 1\``, `updatedBy: actorId`, `updatedAt: sql\`CURRENT_TIMESTAMP\``, and returning the updated feature projection.
  - Retained `deriveSiteSpatial()` as raw `tx.execute(sql\`...\`)` (4-stage `WITH ... MATERIALIZED` PostGIS CTE) with a one-line inline rationale comment referencing spec §§3.1.4 & 9.1.
- **Concurrency & regression test adjustments:**
  - Updated `waitForBlockedQuery` patterns in `backend/tests/sites/sites.controller.patch.integration.spec.ts` and `backend/tests/sites/sites.controller.delete.integration.spec.ts` from raw-SQL-coupled `'SELECT id::text, version, name, province_code, area_rai::text,'` to `'ST_AsGeoJSON('` so lock-order synchronization matches Drizzle's quoted/lowercased `lock()` query while remaining distinct from `lockForSurvey()` (`'ST_DWithin(ST_SetSRID'`).
  - Added assertion `expect(nearProps.name).toBe(originalProps.name)` on the geometry-only `PATCH /sites` integration test in `backend/tests/sites/sites.controller.patch.integration.spec.ts`.
- **Verification:**
  - `npm --prefix backend run build`: exited `0`.
  - `IMPORT_TEST_DATABASE_URL=postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test npm --prefix backend test`: exited `0` — **25 passed (25) test files, 81 passed (81) tests** (`0` failed, `0` skipped; 19 integration files / 75 tests + 6 unit files / 6 tests, including Site create/patch/delete/concurrency, Survey concurrency, and Site/Survey import suites).
