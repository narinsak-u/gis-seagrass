# 01: Baseline verification, query inventory, and search wildcard tests

**What to build:** Establish clean baseline build/test evidence against a disposable PostGIS database, classify all 23 `.execute` statements across R1–R7, and add integration test coverage for literal `%`, `_`, and `\` search terms in `GET /sites?q=`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Run `npm --prefix backend run build` and `npm --prefix backend test` against an isolated disposable PostGIS database via `IMPORT_TEST_DATABASE_URL`, recording exact counts and pass/fail status.
- [x] Verify and record classification (`convert`, `hybrid`, or `retain with reason`) for every `.execute` statement across R1–R7 (noting `import/infrastructure/reference-data.ts`, `advisory-lock.ts`, and `health.controller.ts` stay untouched).
- [x] Add integration test cases in `backend/tests/sites/sites.controller.read.integration.spec.ts` verifying `GET /sites?q=` treats literal `%`, `_`, and `\` as substring characters rather than `LIKE` wildcards.
- [x] Verify the new test passes before refactoring queries.

## Comments

### Baseline & Post-Test Verification Evidence

- **Branch / Base commit:** `ticket/01-baseline-and-query-inventory` created from `refactor/backend-drizzle-query-policy` (`820a1ca`).
- **Disposable PostGIS DB:** `IMPORT_TEST_DATABASE_URL=postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test` (isolated disposable PostGIS container; each test fixture inserts randomized test records and deletes them in `finally` / `afterAll`).
- **Baseline build (`npm --prefix backend run build`):** exited `0` (clean `tsc -p tsconfig.json`).
- **Baseline full test suite (`IMPORT_TEST_DATABASE_URL=... npm --prefix backend test`):** exited `0` — **25 passed (25) test files, 79 passed (79) tests** (`0` failed, `0` skipped; 19 integration files / 73 tests + 6 unit files / 6 tests).
- **Added test coverage:** Added integration test in `backend/tests/sites/sites.controller.read.integration.spec.ts` (`GET /sites treats %, _, and \ in q as literal substring characters rather than LIKE wildcards`), covering positive literal matches (both `name` and `code`, including case-insensitive queries and exact `total` counts) and negative non-matches against Sites without `%`, `_`, or `\` (including wildcard-trap strings `%`, `_`, `\`, `Another_zone`, `Another%zone`), cleaning up inserted Sites in `finally`.
- **Post-test build (`npm --prefix backend run build`):** exited `0`.
- **Post-test full test suite (`IMPORT_TEST_DATABASE_URL=... npm --prefix backend test`):** exited `0` — **25 passed (25) test files, 80 passed (80) tests** (`0` failed, `0` skipped; 19 integration files / 74 tests + 6 unit files / 6 tests; `sites.controller.read.integration.spec.ts`: 9/9 passed).

### Verified `.execute` Query Inventory (23 in-scope R1–R7 + 3 untouched files)

Legend:
- **convert**: Pure Drizzle query builder using schema columns and standard Drizzle operators/clauses with no raw SQL expressions.
- **hybrid**: Drizzle query builder (`.select()`, `.insert()`, `.update()`, `.from()`, `.leftJoin()`, `.where()`, `.groupBy()`, `.orderBy()`, `.limit()`, `.offset()`, `.returning()`, `.for('update')`, `.onConflictDoNothing()`) combined with targeted parameterized `sql<T>` expressions for PostgreSQL/PostGIS functions or explicit casts.
- **retain**: Complete raw SQL statement retained with explicit rationale.

| # | Scope | File | Method (Line) | Classification | Plan / Rationale |
| --- | --- | --- | --- | --- | --- |
| 1 | R1 | `backend/src/surveys/infrastructure/drizzle-survey-list.repository.ts` | `listBySiteCode` (L32) | **hybrid** | Convert `SELECT`/`LEFT JOIN`/`WHERE`/`GROUP BY`/`ORDER BY`/`LIMIT`/`OFFSET` to Drizzle builder; keep targeted `sql<T>` for `ST_X`, `ST_Y`, `array_agg(...) FILTER (...)`, and `::text`/`::float8` casts. |
| 2 | R2 | `backend/src/sites/infrastructure/drizzle-site-read.repository.ts` | `list` count (L18) | **hybrid** | Convert to Drizzle `.select({ total: count() }).from(sites).where(and(...))`; keep `strpos(lower(${sites.code}), lower(${search})) > 0` / `strpos(lower(${sites.name}), lower(${search})) > 0` in targeted `sql` for exact literal substring search. |
| 3 | R2 | `backend/src/sites/infrastructure/drizzle-site-read.repository.ts` | `list` rows (L19) | **hybrid** | Convert to Drizzle `.select({...}).from(sites).where(and(...)).orderBy(asc(sites.code)).limit().offset()`; keep `strpos(lower(...))` predicate and explicit `::text` casts as needed. |
| 4 | R2 | `backend/src/sites/infrastructure/drizzle-site-read.repository.ts` | `detail` (L31) | **hybrid** | Convert to Drizzle `.select({...}).from(sites).where(and(eq(sites.code, code), isNull(sites.deletedAt))).limit(1)`; keep `ST_AsGeoJSON(${sites.geom}, 15)::jsonb` and casts in targeted `sql<T>`. |
| 5 | R2 | `backend/src/sites/infrastructure/drizzle-site-read.repository.ts` | `withinBbox` (L42) | **hybrid** | Convert to Drizzle `.select({...}).from(sites).where(and(...)).orderBy(asc(sites.code))`; keep `ST_Intersects(${sites.geom}, ST_MakeEnvelope(..., 4326))` and `ST_AsGeoJSON(${sites.geom}, 15)::jsonb` in targeted `sql<T>`. |
| 6 | R3 | `backend/src/sites/infrastructure/drizzle-province-read.repository.ts` | `withinBbox` (L12) | **hybrid** | Convert to Drizzle `.select({...}).from(provinces).where(sql\`ST_Intersects(...)\`).orderBy(asc(provinces.code))`; keep `ST_AsGeoJSON(${provinces.geom}, 15)::jsonb` and `ST_Intersects`/`ST_MakeEnvelope` in targeted `sql<T>`. |
| 7 | R4 | `backend/src/surveys/infrastructure/drizzle-survey-status.repository.ts` | `latestCoverPercentages` (L17) | **hybrid** *(or retain w/ rationale)* | Extract shared internal helper in `surveys/infrastructure/` (accepting `db` or `tx`) using Drizzle `$with`/subquery + `array_agg(cover_percent::float8)`; retain raw SQL with inline comment + ADR entry only if builder CTE proves materially noisier (per spec §9.1 & §9.4). |
| 8 | R4 | `backend/src/surveys/infrastructure/drizzle-survey-status.repository.ts` | `latestSurvey` (L33) | **hybrid** | Convert to Drizzle `.select({...}).from(surveys).where(eq(surveys.siteId, BigInt(siteId))).orderBy(desc(surveys.surveyedOn), desc(surveys.id)).limit(1)`; keep targeted `::float8`/`::text` casts. |
| 9 | R5 | `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` | `import` (L18) | **hybrid** | Convert to Drizzle `tx.insert(surveys).values({...}).onConflictDoNothing({ target: surveys.surveyRef, where: isNotNull(surveys.surveyRef) }).returning({ id: surveys.id })`; keep `ST_SetSRID(ST_MakePoint(...), 4326)` in targeted `sql`. |
| 10 | R5 | `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` | `today` (L51) | **hybrid** | Convert to Drizzle `tx.select({ today: sql<string>\`(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text\` })` (required builder conversion per spec §9.1). |
| 11 | R5 | `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` | `create` (L73) | **hybrid** | Convert to Drizzle `tx.insert(surveys).values({...}).returning({ id: surveys.id })`; keep `ST_SetSRID(ST_MakePoint(...), 4326)` in targeted `sql`. |
| 12 | R5 | `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` | `response` row (L114) | **hybrid** | Convert to Drizzle `tx.select({...}).from(surveys).leftJoin(surveySpecies, ...).where(eq(surveys.id, BigInt(id))).groupBy(surveys.id)`; keep `ST_X`, `ST_Y`, `array_agg(...) FILTER (...)`, and casts in targeted `sql<T>`. |
| 13 | R5 | `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` | `response` site status (L123) | **hybrid** *(or retain w/ rationale)* | Replace duplicate single-site latest-date query by calling the shared internal `surveys/infrastructure/` helper consolidated with R4 `latestCoverPercentages` using `tx`. |
| 14 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `create` (L20) | **hybrid** | Convert to Drizzle `tx.insert(sites).values({...}).returning({ version: sites.version, geometry: sql\`ST_AsGeoJSON(...)::jsonb\` })`; keep `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(...), 4326))` and preserve `23505`/`uq_sites_code` → `DUPLICATE_CODE` handling. |
| 15 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `import` (L48) | **hybrid** | Convert to Drizzle `tx.insert(sites).values({...}).onConflictDoNothing().returning({ code: sites.code })`; keep `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(...), 4326))` in targeted `sql`. |
| 16 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `lock` (L60) | **hybrid** | Convert to Drizzle `tx.select({...}).from(sites).where(and(eq(sites.code, code), isNull(sites.deletedAt))).for('update')`; keep `ST_AsGeoJSON(${sites.geom}, 15)::jsonb` in targeted `sql<T>`. |
| 17 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `lockForSurvey` (L79) | **hybrid** | Convert to Drizzle `tx.select({ id: ..., within: sql<boolean>\`ST_DWithin(...)\` }).from(sites).where(and(eq(sites.code, code), isNull(sites.deletedAt))).for('update')`. |
| 18 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `withinDistance` (L95) | **hybrid** | Convert to Drizzle `tx.select({ within: sql<boolean>\`ST_DWithin(...)\` }).from(sites).where(and(eq(sites.id, BigInt(id)), isNull(sites.deletedAt)))`. |
| 19 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `update` with geometry (L105) | **hybrid** | Convert to Drizzle `tx.update(sites).set({...}).where(eq(sites.id, BigInt(site.id))).returning({...})`; keep `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(...), 4326))`, `${sites.version} + 1`, `now()`, and `ST_AsGeoJSON` in targeted `sql`. |
| 20 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `update` name-only (L112) | **hybrid** | Convert and unify with #19 via Drizzle `tx.update(sites).set({...}).where(eq(sites.id, BigInt(site.id))).returning({...})`, keeping atomic `${sites.version} + 1`, `now()`, and `ST_AsGeoJSON` in targeted `sql`. |
| 21 | R6 | `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` | `deriveSiteSpatial` (L132) | **retain** | Confirmed raw-SQL exception (spec §3.1.4 & §9.1): 4-stage `WITH ... MATERIALIZED` PostGIS CTE computing `ST_IsValid`, `ST_IsEmpty`, `ST_Intersects`, `ST_Area(ST_Intersection(...)::geography)` dominant-province tie-break, and `area_rai` rounding in one round trip; builder conversion would degrade readability and risk materialization/plan regressions. |
| 22 | R7 | `backend/src/surveys/infrastructure/drizzle-site-survey-constraint.repository.ts` | `hasSurveys` (L11) | **convert** | Pure Drizzle builder: `tx.select({ id: surveys.id }).from(surveys).where(eq(surveys.siteId, BigInt(siteId))).limit(1)` returning `rows.length > 0`. |
| 23 | R7 | `backend/src/surveys/infrastructure/drizzle-site-survey-constraint.repository.ts` | `hasSurveysOutside` (L19) | **hybrid** | Convert to Drizzle `tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.siteId, BigInt(siteId)), sql\`NOT ST_DWithin(...)\`)).limit(1)` returning `rows.length > 0`, keeping geography 50 m calculation database-side. |

**Inventory summary (R1–R7):** `23` `.execute` statements total — `1` **convert**, `21` **hybrid** (with R4 #7 & R5 #13 consolidating into 1 shared helper, retaining raw SQL only if materially clearer), `1` **retain** (`deriveSiteSpatial`).

**Explicitly untouched / out-of-scope raw SQL files:**
- `backend/src/import/infrastructure/reference-data.ts` (`importProvinces`, L32, 1 `db.execute`): PostGIS `ST_IsValid`/`ST_IsEmpty` check on reference province GeoJSON — left untouched per R7.
- `backend/src/import/infrastructure/advisory-lock.ts` (`withImportAdvisoryLock`, L9 & L13, 2 `pg` `client.query` calls): session-level `pg_advisory_lock`/`pg_advisory_unlock` requiring a pinned `pg.PoolClient` — left untouched per R7.
- `backend/src/platform/health/health.controller.ts` (`HealthController.check`, L16, 1 `pg` `pool.query` call): `SELECT PostGIS_Lib_Version() AS version` platform health check — left untouched.
