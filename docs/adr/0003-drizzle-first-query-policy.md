---
status: accepted
---

# Drizzle-First Query Policy and Raw SQL Exceptions

Backend repositories use Drizzle's typed query builder as the default for persistence operations—`.select()`, `.insert()`, `.update()`, `.delete()`, `.leftJoin()`/`.innerJoin()`, `.groupBy()`, `.orderBy()`, `.limit()`, `.offset()`, `.returning()`, `.for('update')` row locks, `.onConflictDoNothing()`, and `$with` CTEs—referencing tables and columns from the central schema rather than handwritten SQL identifiers.

PostgreSQL and PostGIS constructs that Drizzle does not model natively stay database-side as targeted, parameterized `sql<T>` expressions inside builder queries:

- **Spatial and aggregation expressions:** `ST_GeomFromGeoJSON`, `ST_Multi`, `ST_SetSRID`, `ST_MakePoint`, `ST_MakeEnvelope`, `ST_Intersects`, `ST_DWithin` (on `::geography`), `ST_X`, `ST_Y`, `ST_AsGeoJSON(..., 15)::jsonb`, sorted `COALESCE(array_agg(...) FILTER (...), ARRAY[]::text[])`, and explicit `::text`/`::float8` casts preserving API serialization contracts (`bigint` IDs as strings, `numeric` coordinates/cover as numbers, `YYYY-MM-DD` date strings).
- **Literal-substring text search:** `DrizzleSiteReadRepository.list()` retains `strpos(lower(${sites.code}), lower(${search})) > 0` and `strpos(lower(${sites.name}), lower(${search})) > 0` inside `.where(and(...))` so `%`, `_`, and `\` match literally without `LIKE` wildcard escaping.
- **Shared latest-date cover-percentage helper:** `backend/src/surveys/infrastructure/latest-cover-percentages.ts` encapsulates the `$with('latest_dates')` CTE + `inArray` + `innerJoin` + `array_agg` query over either `DatabaseProvider['db']` or `DrizzleTransaction`, shared by `DrizzleSurveyStatusRepository` and `DrizzleSurveyWriteRepository` without crossing feature boundaries.
- **No string-concatenated SQL:** All dynamic values remain bound through Drizzle operators or parameterized `sql` templates (no `sql.raw`).

Complete raw SQL (`execute`/`query`) is retained only where the query builder would materially hurt clarity, risk query-plan regressions, or conflict with driver-level session requirements:

- **In-scope repository exception:** `deriveSiteSpatial()` in `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` keeps its 4-stage `WITH ... MATERIALIZED` PostGIS CTE (`ST_IsValid`, `ST_IsEmpty`, `ST_Intersects`, `ST_Area(ST_Intersection(...)::geography)` dominant-province tie-break, and `area_rai` rounding in one round trip), documented inline.
- **Untouched platform and CLI boundaries:** `backend/src/import/infrastructure/reference-data.ts` (`db.execute` reference province GeoJSON validation), `backend/src/import/infrastructure/advisory-lock.ts` (`client.query` session `pg_advisory_lock`/`pg_advisory_unlock` on a pinned `pg.PoolClient`), and `backend/src/platform/health/health.controller.ts` (`pool.query` `PostGIS_Lib_Version()` check).

## Considered Options

- **Keep complete `db.execute(sql\`...\`)` statements across repositories:** Rejected because 22 routine read, write, lock, and constraint queries duplicated table/column names as untyped strings and bypassed schema-assisted refactoring.
- **Eliminate every `execute` call including `deriveSiteSpatial()` or wrap PostGIS in a generic GIS repository abstraction:** Rejected because rewriting the 4-stage `MATERIALIZED` spatial CTE into builder calls degrades readability and risks plan regressions, while a generic GIS wrapper adds indirection without simplifying PostGIS semantics.
- **Replace `strpos(lower(...))` with Drizzle `ilike()`:** Rejected because `ILIKE` treats `%`, `_`, and `\` as pattern wildcards, changing literal-substring search behavior or requiring extra escape logic.

## Consequences

- Ordinary persistence queries stay type-checked against `backend/src/platform/database/schema/` while keeping PostgreSQL/PostGIS filtering, aggregation, locking, and atomic increments database-side.
- `sql<T>` only annotates TypeScript types and does not validate runtime values; explicit casts (`::text`, `::float8`, `::jsonb`) and disposable-PostGIS integration tests remain the contract boundary.
- Any future full raw `execute(sql\`...\`)` exception in a repository requires a concise inline rationale comment and an update to `DESIGN.md` / this ADR.
