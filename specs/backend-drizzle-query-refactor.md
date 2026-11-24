# Backend Persistence Refactor — Drizzle-First Query Policy

**Project:** GIS Seagrass Monitoring System  
**Status:** Implemented and verified  
**Target:** `backend/`
**Work type:** Behavior-preserving infrastructure refactor, not a numbered product Step  
**Commit prefix:** `refactor:`

## 1. Problem and objective

The backend already uses Drizzle ORM for schema, transactions, authentication queries, ordinary writes, and some locking. However, several Drizzle repository implementations use complete raw SQL statements for routine joins, filtering, sorting, pagination, projection, and inserts even though Drizzle's typed query builder can express them. This results in repeated handwritten table/column identifiers, less schema-assisted refactoring, and declared response types that are not validated by `db.execute<T>()`.

**Objective:** Use **Drizzle query builder as the default** for ordinary persistence operations, with **typed `sql` expressions inside builder queries** for PostgreSQL/PostGIS-specific functions. Keep complete raw SQL only where doing so is materially clearer or necessary (for example, a multi-stage geospatial CTE), and document each exception. Do not rewrite a complex query merely to reduce the count of `db.execute` calls.

## 2. Invariants and non-goals

- Preserve the existing **full, flat Clean Architecture**: each feature owns `domain`, `application`, `infrastructure`, and `presentation`; repository interfaces stay in `application`, Drizzle implementations stay in `infrastructure`. Do not reorganize folders, rename public classes, or add new architecture layers.
- No public API changes: routes, HTTP statuses, error envelope, response field names/types/order where specified, pagination defaults, auth and role rules, and Swagger schemas remain unchanged.
- Preserve PostGIS semantics and data model: EPSG:4326 geometry; geography-based distance/area; 50-meter boundary inclusivity; geometry validity/coverage; dominant province; site status from **all surveys on the latest date**; server-derived `area_rai` rounded to two decimals.
- Preserve concurrency: per-Site `FOR UPDATE` locking across Site geometry edits, deletion, and Survey insertion/updates; atomic site `version` checks/increments; conditional/conflict behavior; no Survey stranded more than 50 meters by a concurrent Site edit.
- Preserve transactional Survey rows + species links, importer idempotency (`site.code`, `survey_ref`), permanent Site-code reservation, soft-deleted Site visibility, Import advisory lock on a pinned connection, and migration/seed bootstrap order.
- Preserve `bigint` ID serialization as **strings** in HTTP responses, `numeric` cover/area as **numbers** where existing APIs require that, date-only `YYYY-MM-DD` strings, and `created_by` visibility according to current access policy.
- **No schema or migration changes**, new database dependency, endpoint, feature, caching, auth policy, naming refactor, production hardening, or frontend work.
- Tests must not use development or production databases. Only confirmed disposable PostGIS resources.

## 3. Query design rules

### 3.1 Preferred Drizzle usage

1. Use `.select()`, `.insert()`, `.update()`, `.delete()`, `.from()`, `.leftJoin()`, `.where()`, `.groupBy()`, `.orderBy()`, `.limit()`, `.offset()`, `.returning()`, `.for('update')`, `.transaction()`, and conflict handlers for operations they represent naturally.
2. Reference tables and columns via the central Drizzle schema (`sites.code`, `surveys.geom`, etc.), not handwritten SQL identifiers, when supported.
3. Embed targeted PostgreSQL/PostGIS constructs in builder queries with parameterized `sql` expressions: `ST_DWithin`, `ST_Intersects`, `ST_MakeEnvelope`, `ST_X`, `ST_Y`, `ST_AsGeoJSON`, `ST_Area`, `array_agg`, casts and date functions.
4. Keep a **complete** raw SQL statement only when the builder would materially decrease clarity, create awkward query plans, or lose essential correctness. Expected exception: the existing `deriveSiteSpatial()` geospatial validation/coverage/area `WITH ... MATERIALIZED` query. Other exceptions require a concise comment and explanation in the final change summary or `DESIGN.md`.
5. Avoid unnecessary query round trips or fetching all related rows just to assemble one paginated response. No N+1 queries in list endpoints.
6. Preserve existing database-side filtering, spatial index-friendly `ST_Intersects`, aggregation, ordering, and limit/offset; never move filtering/aggregation into JavaScript for convenience.
7. No string-concatenated SQL. All dynamic values stay bound via Drizzle APIs or parameterized `sql` templates.

### 3.2 Runtime types and mapping

- `sql<T>` declares the expected TypeScript type but does not automatically validate or convert database values. Use explicit PostgreSQL casts and/or `.mapWith(...)` for value conversion where appropriate; preserve API contracts.
- Retain `::text`/`String(...)` where IDs must serialize as strings; use `BigInt()` at DB boundaries where schema columns are bigint.
- Retain `::float8` or controlled mapping for `NUMERIC` values that API consumers expect as numbers; do not accidentally return strings or precision-altered values. Keep numeric validation unchanged.
- Retain `surveyed_on` as date-only `YYYY-MM-DD`, without timezone conversion.
- For GeoJSON expressions use `ST_AsGeoJSON(..., 15)::jsonb` or an equivalent verified transformation so geometry is a JSON object, not JSON-encoded string. Preserve Polygon→MultiPolygon normalization.
- Preserve `species` deterministic alphabetical code ordering and empty-array rather than `[null]` when no join rows exist. Read projections must not duplicate survey items due to joins.
- Avoid `SELECT *`; project only required fields. Shared spatial helper functions are optional and should remain small, typed, and infrastructure-owned rather than creating a generic GIS abstraction.

## 4. File-by-file implementation plan

### R1 — `backend/src/surveys/infrastructure/drizzle-survey-list.repository.ts` (first priority)

- Keep the Site existence/active check and count query in Drizzle.
- Replace raw list `SELECT` with a Drizzle builder using `.leftJoin(surveySpecies, ...)`, `.groupBy(surveys.id)`, `.orderBy(desc(surveys.surveyedOn), desc(surveys.id))`, `.limit(pageSize)`, `.offset(...)`.
- Use SQL expressions only for `ST_X`, `ST_Y`, `::float8`, `::text` (if needed), and deterministic `array_agg(...) FILTER (...)`.
- Preserve `SurveyPage` exactly, with `id: string`, `created_by: string | null`, numeric coordinates/cover, date-only `surveyed_on`, and `species: string[]`.
- Ensure missing or soft-deleted Site returns existing not-found behavior and pagination does not produce duplicates.

### R2 — `backend/src/sites/infrastructure/drizzle-site-read.repository.ts`

- Replace raw list count and paginated SELECT with Drizzle builder, preserving active-only filtering, optional province match, and case-insensitive **substring** search on code/name. Preserve `ORDER BY code ASC`, total and page behavior. Keep `strpos(lower(${sites.code}), lower(${search})) > 0` / `strpos(lower(${sites.name}), lower(${search})) > 0` using Drizzle schema column references inside `.where(and(...))` so literal `%`, `_`, and backslash search semantics remain exact without SQL `LIKE` wildcard escaping, and add integration tests covering those characters.
- Replace Site detail with a Drizzle projection plus a targeted `ST_AsGeoJSON` SQL expression.
- Replace BBOX query structure with Drizzle `.where(and(...))` using `ST_Intersects(geom, ST_MakeEnvelope(..., 4326))` in `sql`, optional province filter, and deterministic code ordering. Do not load all Sites then filter in JS.
- Preserve omission of geometry from Site list summaries and inclusion of valid JSON geometry in detail/BBOX responses.

### R3 — `backend/src/sites/infrastructure/drizzle-province-read.repository.ts`

- Use Drizzle `.select()`, `.where(sql\`ST_Intersects(...)\`)`, and `.orderBy(...)`; keep `ST_AsGeoJSON(...,15)::jsonb` in typed SQL projection.
- Preserve bbox intersection semantics and province field names/order; no changes to province data.

### R4 — `backend/src/surveys/infrastructure/drizzle-survey-status.repository.ts`

- Keep status calculation **database driven**, selecting cover percentages on every Site's latest survey date; retain same-day ties, historical-date exclusion, and `no_data` for Sites without surveys.
- Prefer Drizzle for latest-survey read ordering and projection (`surveyed_on DESC`, `id DESC`). For the grouped latest-date query, use a Drizzle subquery/CTE if clearer; retain raw SQL if the SQL version is simpler, with reason documented.
- Do not introduce a stored status field or a different status formula.

### R5 — `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts`

- Convert routine INSERT/select/response projection into Drizzle builder where practical; use `sql` for PostGIS point construction, date casts, coordinates and deterministic species aggregation.
- Keep API-created `survey_ref = NULL`, imported `survey_ref` identity, idempotent `ON CONFLICT (survey_ref) ... DO NOTHING`, and correct audit fields.
- Preserve `tx` shared from Site–Survey workflow and atomic Survey/species-link creation, replacement, deletion, and rollback. Do not add implicit transactions per repository call that split the existing outer transaction.
- Keep necessary `FOR UPDATE` row locks and access to the selected Site in the same transaction; no change to Partial PATCH semantics.
- Status calculated for mutation responses must remain correct in the same transactional view and match Site-read status logic. Extract a small internal query helper inside `surveys/infrastructure/` (accepting `db` or `tx`) so `DrizzleSurveyStatusRepository` and `DrizzleSurveyWriteRepository` share the same latest-date cover-percentage query without crossing feature boundaries.

### R6 — `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` (highest risk; do last)

- Convert routine create/import/update/retire SQL to Drizzle builder when it preserves the behavior clearly. Use `sql` fragments for `ST_GeomFromGeoJSON`, SRID, MultiPolygon normalization, `ST_AsGeoJSON`, and derived values.
- Keep the `deriveSiteSpatial()` multi-CTE query raw unless a builder version is demonstrably simpler and equally correct. Preserve validity and positive-area province intersection checks, largest-overlap province tie-breaking, and rai rounding.
- Preserve active Site `FOR UPDATE` locking used by Site and Survey operations, conflict/error translation (`DUPLICATE_CODE`, `VERSION_CONFLICT`, etc.), soft delete and permanent reserved site codes. Do not convert version checking into a non-atomic read-then-write.
- Preserve exact Site Geometry edit/Survey insertion serialization; no weaker locking or looser isolation introduced by the rewrite.
- Keep Postgres transaction and constrained-write outcomes equivalent. Pay attention to DB error codes/constraint names after builder conversion.

### R7 — already Drizzle-first and supporting code

- `backend/src/auth/infrastructure/drizzle-auth.repository.ts`: no rewrite required; retain behavior.
- `backend/src/surveys/infrastructure/drizzle-site-survey-constraint.repository.ts`: express `EXISTS` checks through Drizzle builder (e.g., `.select(...).from(surveys).where(...).limit(1)` or Drizzle `EXISTS` expression) unless materially noisier, keeping the geography-based 50 m calculation database-side.
- `backend/src/import/infrastructure/*`: leave untouched except changes strictly necessary for compatibility with repository adapters; importer-wide advisory locking and pinned connection remain raw SQL when appropriate.
- `backend/src/platform/database/schema/index.ts`: no schema changes; optional typed helper functions for existing columns must not alter migration output.
- `backend/src/site-survey-workflows/infrastructure/*`: maintain transaction runner and opaque context unchanged.

## 5. Recommended query examples (illustrative, not authoritative code)

### 5.1 List Surveys

```ts
const rows = await db
  .select({
    id: sql<string>`${surveys.id}::text`,
    lon: sql<number>`ST_X(${surveys.geom})::float8`,
    lat: sql<number>`ST_Y(${surveys.geom})::float8`,
    surveyed_on: surveys.surveyedOn,
    cover_percent: sql<number>`${surveys.coverPercent}::float8`,
    note: surveys.note,
    created_by: surveys.createdBy,
    species: sql<string[]>`COALESCE(
      array_agg(${surveySpecies.speciesCode} ORDER BY ${surveySpecies.speciesCode})
        FILTER (WHERE ${surveySpecies.speciesCode} IS NOT NULL),
      ARRAY[]::text[]
    )`,
  })
  .from(surveys)
  .leftJoin(surveySpecies, eq(surveySpecies.surveyId, surveys.id))
  .where(eq(surveys.siteId, site.id))
  .groupBy(surveys.id)
  .orderBy(desc(surveys.surveyedOn), desc(surveys.id))
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

### 5.2 Site bounding box

```ts
const rows = await db.select({
  code: sites.code,
  name: sites.name,
  geometry: sql<GeoJSON.MultiPolygon>`ST_AsGeoJSON(${sites.geom}, 15)::jsonb`,
}).from(sites).where(and(
  isNull(sites.deletedAt),
  sql`ST_Intersects(
    ${sites.geom},
    ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)
  )`,
));
```

These examples are pseudocode-level implementation guidance: confirm type declarations with installed Drizzle/TypeScript version, project GeoJSON types, and real PostGIS integration tests. `sql<T>` alone is not runtime validation.

## 6. Tests and verification

**Required baseline:** Run the current backend build and **full existing test suite** in an isolated disposable PostGIS environment before editing; record failures separately from refactor regressions. Do not modify existing DB or seed source files.

**Required checks after each phase:**

1. `npm run build` in `backend/`; no TypeScript/type regressions.
2. Unit tests and manual inspection against `DESIGN.md` and ADR-0002 (flat four-layer Clean Architecture boundaries unchanged; `architecture.spec.ts` was removed in ADR-0002).
3. All existing HTTP/PostGIS integration tests (plus added tests for any uncovered Section 6 scenarios such as literal `%`, `_`, and `\` search in `GET /sites?q=`) using the same disposable environment, never regular development DB.
4. Compare representative before/after API response bodies using deterministic fixtures where feasible; verify numeric vs string types, date format, null/empty array behavior, and ordering.
5. Confirm the generated SQL is parameterized and includes necessary joins, filters, limits, PostGIS functions, and row locks. Use EXPLAIN only on disposable data if performance is materially at issue.

### Required behavioral scenarios

- **Site list:** pagination, empty page, stable sorting, case-insensitive literal substring search (`%`, `_`, backslash), province filter, active-only and geometry omitted.
- **Site detail/BBOX:** GeoJSON object shape, geometry type, selected bbox intersection including boundary contact, soft-deleted filtering and no full-table fallback.
- **Survey list:** missing/soft-deleted Site; newest date first and ID tie-break; page count; species deterministic list; zero-species handling if permitted; `created_by` null on imported observations.
- **Survey writes:** POST/PATCH/DELETE; partial PATCH preserves unspecified fields; species replacement atomicity and rollback; date validation, 50 m distance; status changes immediately after mutations.
- **Site writes:** valid/invalid geometry, outside province, computed rai, duplicate/reused deleted code, soft delete restrictions, version conflict payload.
- **Concurrency:** two Site PATCH requests at same version → exactly one success and one 409; concurrent Survey insert versus Site geometry edit/delete preserves all spatial and active-Site invariants.
- **Import:** rerun idempotency and expected acceptance/rejection counts; unchanged import report semantics; no new data corruption or duplicate keys.
- **Auth:** role checks and response privacy unchanged by query refactor.

**Verification evidence:** Record command, exit status, relevant test counts, DB isolation method and cleanup; no claims of success for skipped tests. Use the existing independent `verify` skill to audit the confirmed spec, tickets, ADRs, implementation, and executed evidence, without modifying files.

## 7. Implementation and commit plan

1. Inspect `AGENTS.md`, `specs/README.md`, current backend tree, applicable architecture specs and ADRs (especially naming/layout decisions), `DESIGN.md`, Git status, and available test/fixture setup.
2. Confirm open decisions using `/grill-with-docs` and write the agreed `.scratch/backend-drizzle-query-refactor/spec.md` plus actionable tickets per `docs/agents/issue-tracker.md` (when ticketing is requested). This spec is Confirmed once those decisions are recorded.
3. Capture baseline test evidence; inventory the 23 `.execute` statements across R1–R7 (plus `reference-data.ts`) and classify each as **convert**, **hybrid**, or **retain with reason**.
4. Refactor low-risk reads in order: Survey List → Site Read → Province Read → Survey Status.
5. Refactor Survey Write and then Site Write, preserving transactions and concurrency; minimize unrelated formatting and class changes.
6. Run the complete regression suite, inspect generated SQL and the final diff, and update `DESIGN.md`/an ADR with the finalized Drizzle-first policy and any remaining raw-query exceptions. Preserve historical specs as evidence; add only a supersession/policy pointer if necessary.
7. Independently verify; fix any failures and rerun verification. Stage only scope-relevant files and commit with `refactor:` prefix. Stop before unrelated Step work.

Suggested commits:

```text
refactor: convert site and survey read queries to drizzle builder
refactor: use drizzle builder for survey writes while preserving transactions
refactor: simplify site persistence queries and document spatial sql exceptions
```

## 8. Definition of done

- [x] Inventory documents all complete raw SQL statements in targeted repositories and classifies each as convert/hybrid/retain with reason.
- [x] Ordinary joins, pagination, sorting, projections and CRUD use Drizzle builder where meaningfully supported.
- [x] PostgreSQL/PostGIS functions remain database-side as targeted `sql` expressions; complex spatial CTEs may stay raw with clear rationale.
- [x] Query parameters remain bound; no SQL string interpolation or weakened input handling.
- [x] All API responses preserve existing field names, types, sorting, null behavior, and errors.
- [x] DB transactions, row locks, optimistic locking, Survey spatial invariants, and importer idempotency are preserved.
- [x] No DB schema/migration/seed data or external API behavior changes.
- [x] Build, unit tests, manual Clean Architecture review (per `DESIGN.md`/ADR-0002), and full API/PostGIS integration and concurrency tests pass on a disposable DB (or every gap is explicitly reported, not marked done).
- [x] `DESIGN.md`, `docs/adr/0003-drizzle-first-query-policy.md`, and changed query exceptions are documented.
- [x] Independent verification passes before `refactor:` commit(s); Step 6 and other features not started.

## 9. Confirmed decisions

1. **Exception strictness (Confirmed — pragmatic):** Keep `deriveSiteSpatial()` as full raw SQL (`WITH ... MATERIALIZED`). Require Drizzle builder for `today()`, single-table/join CRUD, and locks; convert `latestCoverPercentages` and `EXISTS` unless the builder version is materially noisier, and require a one-line inline comment plus doc/ADR entry for any remaining `execute(sql\`...\`)` exception besides `deriveSiteSpatial()`.
2. **Text search predicate (Confirmed):** Keep `strpos(lower(${sites.code}), lower(${search})) > 0` and `strpos(lower(${sites.name}), lower(${search})) > 0` using Drizzle schema columns inside `.where(and(...))` so literal-substring semantics are preserved without `LIKE` wildcard escaping; add integration coverage for literal `%`, `_`, and `\` search terms.
3. **Projection normalization (Confirmed):** Retain inline `sql<T>` casts and PostGIS expressions by default, extracting small typed helpers only where genuinely repeated without creating a generic GIS abstraction.
4. **Status query consolidation (Confirmed):** Extract one small internal query helper in `surveys/infrastructure/` (accepting `db` or `tx`) so `DrizzleSurveyStatusRepository` and `DrizzleSurveyWriteRepository` share the same latest-date cover-percentage query without cross-feature architecture changes.
5. **Test coverage & disposable PostGIS (Confirmed):** Add integration tests for uncovered Section 6 scenarios (such as literal `%`, `_`, and `\` in `GET /sites?q=`) and run all integration checks against an isolated disposable PostGIS database via `IMPORT_TEST_DATABASE_URL` with cleanup.
6. **Documentation, ADR & issue tracking (Confirmed):** Update `DESIGN.md`, add `docs/adr/0003-drizzle-first-query-policy.md`, keep `specs/backend-drizzle-query-refactor.md` as the confirmed spec (without rewriting historical Step specs), and track implementation via `.scratch/backend-drizzle-query-refactor/spec.md` and numbered tickets under `.scratch/backend-drizzle-query-refactor/issues/`.
