# 02: Convert Survey and Site read repositories (R1–R4) to Drizzle builder

**What to build:** Convert `DrizzleSurveyListRepository`, `DrizzleSiteReadRepository`, `DrizzleProvinceReadRepository`, and `DrizzleSurveyStatusRepository` to Drizzle query builder with typed `sql<T>` expressions, extracting a shared internal latest-date cover-percentage helper in `surveys/infrastructure/`.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] **R1 (`drizzle-survey-list.repository.ts`):** Replace the `listBySiteCode` `db.execute` join query with Drizzle `.select()`, `.leftJoin(surveySpecies, ...)`, `.groupBy(surveys.id)`, `.orderBy(desc(surveys.surveyedOn), desc(surveys.id))`, `.limit()`, and `.offset()`, preserving `id: string`, `lon`/`lat`/`cover_percent` numbers, `surveyed_on` date string, `created_by: string | null`, and sorted `species: string[]` (`[]` when empty).
- [x] **R2 (`drizzle-site-read.repository.ts`):** Convert `list` (count + paginated rows), `detail`, and `withinBbox` to Drizzle builder while keeping `strpos(lower(${sites.code}), lower(${search})) > 0` / `strpos(lower(${sites.name}), lower(${search})) > 0` with schema column refs, `ST_AsGeoJSON(..., 15)::jsonb`, and `ST_Intersects(..., ST_MakeEnvelope(...))`.
- [x] **R3 (`drizzle-province-read.repository.ts`):** Convert `withinBbox` to Drizzle `.select()`, `.where(sql\`ST_Intersects(...)\`)`, and `.orderBy(asc(provinces.code))`.
- [x] **R4 (`drizzle-survey-status.repository.ts`):** Convert `latestSurvey` to Drizzle builder; convert `latestCoverPercentages` via Drizzle `$with` CTE + `inArray` (or document one-line rationale if raw SQL stays clearer), and expose an internal `surveys/infrastructure/` helper usable with either `db` or `tx`.
- [x] Confirm `backend` build, unit tests, and read integration tests pass on disposable PostGIS.

## Comments

### Implementation & Verification Evidence

- **Branch / Base commit:** `ticket/02-convert-read-repositories-to-drizzle` created from `refactor/backend-drizzle-query-policy` (`680ee8e`).
- **R1 (`backend/src/surveys/infrastructure/drizzle-survey-list.repository.ts`):** Replaced the raw `db.execute` query in `listBySiteCode` with Drizzle `.select().from(surveys).leftJoin(surveySpecies, ...).where(...).groupBy(surveys.id).orderBy(desc(surveys.surveyedOn), desc(surveys.id)).limit().offset()`, keeping targeted `sql<T>` expressions for `id::text`, `ST_X`, `ST_Y`, `cover_percent::float8`, and sorted `COALESCE(array_agg(...) FILTER (...), ARRAY[]::text[])`.
- **R2 (`backend/src/sites/infrastructure/drizzle-site-read.repository.ts`):** Replaced all 4 `db.execute` calls across `list` (count + paginated rows), `detail`, and `withinBbox` with Drizzle `.select()` builders, retaining `strpos(lower(${sites.code}), lower(${filters.search})) > 0` / `strpos(lower(${sites.name}), lower(${filters.search})) > 0`, `ST_AsGeoJSON(${sites.geom}, 15)::jsonb`, and `ST_Intersects(${sites.geom}, ST_MakeEnvelope(..., 4326))` with schema column references.
- **R3 (`backend/src/sites/infrastructure/drizzle-province-read.repository.ts`):** Replaced `db.execute` in `withinBbox` with Drizzle `.select().from(provinces).where(sql\`ST_Intersects(...)\`).orderBy(asc(provinces.code))` and `ST_AsGeoJSON(${provinces.geom}, 15)::jsonb`.
- **R4 (`backend/src/surveys/infrastructure/drizzle-survey-status.repository.ts` & `backend/src/surveys/infrastructure/latest-cover-percentages.ts`):**
  - Converted `latestSurvey` to Drizzle `.select().from(surveys).where(...).orderBy(desc(surveys.surveyedOn), desc(surveys.id)).limit(1)`.
  - Converted `latestCoverPercentages` to a Drizzle `$with('latest_dates')` CTE + `inArray` + `innerJoin` + `groupBy` query (zero raw `.execute` calls across R1–R4), using alias `latest_surveyed_on` in the CTE so the join predicate stays unambiguous in PostgreSQL.
  - Extracted `queryLatestCoverPercentages(db: SurveyQueryExecutor, siteIds)` into flat `backend/src/surveys/infrastructure/latest-cover-percentages.ts` accepting `DatabaseProvider['db'] | DrizzleTransaction` for reuse by Ticket 03's `DrizzleSurveyWriteRepository.response(tx, id)`.
- **Added read test coverage:** Added integration test in `backend/tests/surveys/surveys.controller.read.integration.spec.ts` verifying deterministic alphabetical species sorting without row duplication, empty `[]` for zero-species surveys, exact runtime types, and `404 SITE_NOT_FOUND` for soft-deleted Sites.
- **Build & test verification:**
  - `npm --prefix backend run build`: exited `0`.
  - `IMPORT_TEST_DATABASE_URL=postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test npm --prefix backend test`: exited `0` — **25 passed (25) test files, 81 passed (81) tests** (`0` failed, `0` skipped; 19 integration files / 75 tests + 6 unit files / 6 tests).
