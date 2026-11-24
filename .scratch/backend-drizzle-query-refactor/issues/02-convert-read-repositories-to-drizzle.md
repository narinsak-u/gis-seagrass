# 02: Convert Survey and Site read repositories (R1–R4) to Drizzle builder

**What to build:** Convert `DrizzleSurveyListRepository`, `DrizzleSiteReadRepository`, `DrizzleProvinceReadRepository`, and `DrizzleSurveyStatusRepository` to Drizzle query builder with typed `sql<T>` expressions, extracting a shared internal latest-date cover-percentage helper in `surveys/infrastructure/`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] **R1 (`drizzle-survey-list.repository.ts`):** Replace the `listBySiteCode` `db.execute` join query with Drizzle `.select()`, `.leftJoin(surveySpecies, ...)`, `.groupBy(surveys.id)`, `.orderBy(desc(surveys.surveyedOn), desc(surveys.id))`, `.limit()`, and `.offset()`, preserving `id: string`, `lon`/`lat`/`cover_percent` numbers, `surveyed_on` date string, `created_by: string | null`, and sorted `species: string[]` (`[]` when empty).
- [ ] **R2 (`drizzle-site-read.repository.ts`):** Convert `list` (count + paginated rows), `detail`, and `withinBbox` to Drizzle builder while keeping `strpos(lower(${sites.code}), lower(${search})) > 0` / `strpos(lower(${sites.name}), lower(${search})) > 0` with schema column refs, `ST_AsGeoJSON(..., 15)::jsonb`, and `ST_Intersects(..., ST_MakeEnvelope(...))`.
- [ ] **R3 (`drizzle-province-read.repository.ts`):** Convert `withinBbox` to Drizzle `.select()`, `.where(sql\`ST_Intersects(...)\`)`, and `.orderBy(asc(provinces.code))`.
- [ ] **R4 (`drizzle-survey-status.repository.ts`):** Convert `latestSurvey` to Drizzle builder; convert `latestCoverPercentages` via Drizzle `$with` CTE + `inArray` (or document one-line rationale if raw SQL stays clearer), and expose an internal `surveys/infrastructure/` helper usable with either `db` or `tx`.
- [ ] Confirm `backend` build, unit tests, and read integration tests pass on disposable PostGIS.
