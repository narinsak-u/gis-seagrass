# 03: Convert Survey write and constraint repositories (R5 & R7) to Drizzle builder

**What to build:** Convert remaining raw `.execute` calls in `DrizzleSurveyWriteRepository` and `DrizzleSiteSurveyConstraintRepository` to Drizzle builder while preserving outer `tx` boundaries, row locking, idempotent import conflict handling, and transactional `siteStatus` responses.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] **R5 (`drizzle-survey-write.repository.ts`):** Convert `import` (using `.onConflictDoNothing({ target: surveys.surveyRef, where: sql\`${surveys.surveyRef} IS NOT NULL\` })`), `today` (tableless `tx.select(...)`), `create`, and `response` survey projection to Drizzle builder.
- [x] Reuse the shared internal `surveys/infrastructure/` latest-date cover-percentage helper inside `DrizzleSurveyWriteRepository.response(tx, id)` so mutation responses use the exact same `siteStatus` logic on the active transaction.
- [x] **R7 (`drizzle-site-survey-constraint.repository.ts`):** Express `hasSurveys` and `hasSurveysOutside` via Drizzle builder (keeping geography-based 50 m `ST_DWithin` database-side), or document a concise exception comment if raw `EXISTS` is materially clearer.
- [x] Confirm `backend` build, unit tests, Survey write/concurrency integration tests, and Survey importer tests pass on disposable PostGIS.

## Comments

### Implementation & Verification Evidence

- **Branch / Base commit:** `ticket/03-convert-survey-write-and-constraints-to-drizzle` branched from `refactor/backend-drizzle-query-policy` (`b547a5e`).
- **R5 (`backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts`):**
  - Converted all 5 `.execute` calls (`import`, `today`, `create`, `response` row projection, and `response` site-status aggregation) to Drizzle query builder with parameterized `sql<T>` expressions; `0` `.execute` calls remain.
  - `import` uses `tx.insert(surveys).values(...).onConflictDoNothing({ target: surveys.surveyRef, where: sql\`${surveys.surveyRef} IS NOT NULL\` }).returning({ id: surveys.id })` and preserves duplicate-ref skipping and species-link inserts on the outer `tx`.
  - `today` uses `tx.select({ today: sql<string>\`(clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text\` }).from(sql\`(VALUES (1)) AS _\`)` (Drizzle 0.45.4 `PgSelectBuilder` requires `.from(...)` to produce a runnable `QueryPromise`), preserving unqualified `clock_timestamp()` resolution.
  - `create` uses `tx.insert(surveys).values(...).returning({ id: surveys.id })` with `surveyRef` unset (`NULL`), `ST_SetSRID(ST_MakePoint(...), 4326)`, `coverPercent: String(input.cover_percent!)`, `note: input.note ?? null`, and `createdBy`/`updatedBy`.
  - `response` uses `tx.select(...).from(surveys).leftJoin(surveySpecies, ...).where(eq(surveys.id, BigInt(id))).groupBy(surveys.id)` and delegates site-status cover-percentage lookup to shared `queryLatestCoverPercentages(tx, [row.site_id])` on the same active `tx`.
- **R7 (`backend/src/surveys/infrastructure/drizzle-site-survey-constraint.repository.ts`):**
  - Converted both `hasSurveys` and `hasSurveysOutside` to Drizzle `.select({ id: surveys.id }).from(surveys).where(...).limit(1)` returning `result.length > 0`, keeping `NOT ST_DWithin(${surveys.geom}::geography, ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)::geography, 50)` database-side; removed unused `Inject` import; `0` `.execute` calls remain.
- **Verification:**
  - `npm --prefix backend run build`: exited `0`.
  - `IMPORT_TEST_DATABASE_URL=postgres://seagrass_test:seagrass_test@127.0.0.1:5439/seagrass_test npm --prefix backend test`: exited `0` — **25 passed (25) test files, 81 passed (81) tests** (`0` failed, `0` skipped; 19 integration files / 75 tests + 6 unit files / 6 tests, including Survey write, mutation, delete, concurrency, Site patch/delete constraint, and Survey import suites).
  - Inspected compiled Drizzle `.toSQL()` output confirming parameterized queries and `ON CONFLICT ("survey_ref") WHERE "surveys"."survey_ref" IS NOT NULL DO NOTHING`.
