Status: ready-for-agent

## Problem Statement

A developer can start the Seagrass Monitoring System, but its PostGIS tables are empty. The supplied province, species, Site, and survey records cannot yet be explored or checked. Repeated imports must not overwrite existing observations; malformed source records must not silently enter the database or disappear without an audit trail.

## Solution

A developer starts the existing three-service stack or runs one backend import command. After migrations, the importer reads the four committed, unchanged source files in order, validates records, stores accepted provinces, species, Sites, and surveys in PostGIS, and writes a host-accessible rejection report. Repeated runs skip existing identities without changing their data, while reporting source errors again. The API does not listen until import completes; unavailable inputs, malformed whole-file structure, and infrastructure errors fail startup visibly.

## User Stories

1. As a developer, I want the four original source files committed unchanged, so that every import has reproducible input.
2. As a developer, I want the API container to read the sources without write access, so that an import cannot alter them.
3. As a developer, I want one backend import command, so that I can rerun the same import locally or inside the API container.
4. As a developer, I want startup to import after the database is healthy and migrations finish, so that the API serves populated schema data.
5. As a developer, I want the API to wait until import finishes before listening, so that health does not imply an incomplete startup.
6. As a developer, I want province records imported before Sites, so that Site assignments use available reference geography.
7. As a developer, I want species imported before surveys, so that species links resolve against known master data.
8. As a data steward, I want invalid province geometries rejected, so that reference boundaries remain trustworthy.
9. As a data steward, I want province and Site polygons stored in the required MultiPolygon representation, so that valid Polygon inputs need no artificial repair.
10. As a data steward, I want malformed coordinates and out-of-range longitude or latitude rejected, so that swapped or impossible coordinates are never silently corrected.
11. As a data steward, I want self-intersecting, empty, and otherwise invalid Site shapes rejected without repair, so that source defects stay visible.
12. As a data steward, I want a Site assigned to the province with its largest positive geographic overlap, so that boundary-touching alone never determines ownership.
13. As a data steward, I want ties in province overlap resolved deterministically by code, so that reruns select the same province.
14. As an analyst, I want Site area calculated from geographic square meters and stored in rai to two decimals, so that reported area uses the project's unit.
15. As a developer, I want source-internal duplicate codes and survey references rejected after their first occurrence, so that import order has a deterministic result.
16. As a developer, I want existing province, species, Site, and survey identities skipped without updates, so that reruns preserve recorded values.
17. As a data steward, I want a Soft-deleted site code to remain reserved during import, so that historical records are not implicitly restored or recreated.
18. As a data steward, I want surveys referring to Soft-deleted sites rejected as missing active Sites, so that inactive geography acquires no new observations.
19. As a data steward, I want quoted CSV fields read correctly with their source positions, so that valid observations and rejection locations survive parsing.
20. As a data steward, I want surveys rejected when the referenced active Site is absent, so that observations never point to unimportable geography.
21. As a data steward, I want survey points validated against the referenced Site within 50 meters inclusive, so that distance checks use real geographic units.
22. As a data steward, I want finite survey coordinates and cover percentages between 0 and 100 inclusive, so that impossible observations are excluded.
23. As a data steward, I want valid dates no later than today in Bangkok, so that future observations cannot enter because of server time-zone differences.
24. As a data steward, I want every survey species code checked, so that unknown or empty codes reject the whole observation instead of vanishing from its associations.
25. As an analyst, I want an accepted survey and all its species associations stored atomically, so that no partial observation appears.
26. As a developer, I want concurrent imports serialized, so that startup and manual runs cannot race or duplicate records.
27. As a data steward, I want every rejected record reported with source, position, and reason, so that I can correct source data without guessing.
28. As a data steward, I want the report to use valid UTF-8 CSV escaping, so that quoted reasons remain machine-readable.
29. As a developer, I want each run to report inserted, skipped-existing, and rejected totals per source, so that rerun behavior is visible.
30. As a data steward, I want a fresh report to include source errors even on later runs, so that idempotent skips do not erase rejection evidence.
31. As a developer, I want malformed whole files, unreadable inputs, and database errors to fail nonzero, so that API startup never conceals a failed import.
32. As a developer, I want data to survive normal Compose shutdown and restart, so that existing Sites and surveys remain unchanged.
33. As a developer, I want README guidance for commands, actual results, report location, and limits, so that others can reproduce the import safely.
34. As a developer, I want the existing geometry indexes retained, so that imported spatial data remains queryable.

## Implementation Decisions

- Keep one backend-owned importer and one manual npm command; reuse it in API startup after the existing migration runner. Keep the existing database, API, and web services; add no permanent service, root workspace, or shared package.
- Commit the four supplied source files unchanged in the backend seed-data directory. Mount that directory read-only in the API container. Use an independently writable, stable host-accessible location for the tracked CSV report.
- Import in this order: provinces, species, Sites, surveys. Fail on unreadable inputs, malformed whole-file structure, or infrastructure/database errors; reject expected record-level validation failures and continue.
- Require FeatureCollection structure for province and Site geography; require species records to contain nonempty code and both names. Require the CSV header fields and parse quoted UTF-8 fields with a real CSV parser. Preserve source position, counting GeoJSON features from one and CSV records with the header at line one.
- Validate longitude, latitude, polygon structure, emptiness, and validity without coordinate swaps or geometry repair. Normalize valid Polygons into MultiPolygons for storage; use PostGIS geometry type/SRID 4326 and its validity checks as authority.
- Assign a Site to the province with largest strictly positive geographic intersection area, breaking ties by province code. Calculate `area_rai` server-side with `ROUND((ST_Area(geom::geography)/1600)::numeric,2)`.
- Require nonempty Site names and codes. For duplicate identities within each source, keep the first occurrence and reject later occurrences. Skip any identity already in the database without overwriting it.
- A Soft-deleted site code stays reserved despite the schema allowing another active Site with that code. Skip it as existing; never restore it implicitly. A survey referring to it fails as `SITE_NOT_FOUND`. Record this policy in design documentation.
- Require each survey to reference an active persisted Site. Validate finite WGS84 point coordinates, inclusive 50-meter Site proximity through PostGIS geography, finite inclusive 0–100 cover, strict valid `YYYY-MM-DD` dates no later than Bangkok today, and every nonempty species code split on `|` against stored species.
- Insert each accepted survey and its species links atomically. Use parameterized SQL, per-record isolation where needed, a database advisory lock across import instances, and uniqueness constraints as final protection.
- Emit a fresh UTF-8 CSV report every run, including a header with at least `file,row,reason`, correct escaping, and source validation errors even if previously accepted rows now skip. Summarize inserted, skipped-existing, and rejected counts per source at runtime; never hard-code results.
- Reuse the existing six-table schema, referential constraints, and spatial GiST indexes rather than adding another schema or raw species array.

## Testing Decisions

- A good test checks externally observable CLI behavior, persisted PostGIS data, report contents, or API readiness. It must fail on a plausible user-visible defect and avoid source-text or internal wiring assertions.
- Primary seam: invoke the public import command against an isolated PostGIS fixture database and fixture source directory; inspect persisted province, species, Site, survey, species-link, and report data. This tests validation, spatial SQL, atomicity, idempotency, and output as one behavior.
- Secondary seam: unit-test pure parsers and domain validation for malformed JSON/CSV, quoted CSV, required fields, duplicate identities, dates, finite numbers, and species splitting. These rules already need to serve future Site and survey APIs.
- Reuse the rollback-only SQL schema-check pattern for DB-backed assertions. Reuse the existing Compose health/readiness pattern to verify migration, import, and listener order; the current backend has no importer test suite to extend.
- Include self-intersecting and empty polygons; positive overlap, touch-only, tie-break and geographic area; point distances near 30, 50, and 200 meters with boundary-aware fixtures.
- Include cover -1, 0, 100, and 101; Bangkok yesterday, today, tomorrow; known, unknown, and empty species; a missing or Soft-deleted site; duplicates both within sources and already persisted.
- Confirm invalid surveys create neither survey nor association, valid ones create all associations, and reruns preserve counts and representative values. Check both report escaping and real source position/reason, including repeat-run rejection evidence.
- Verify source hashes remain unchanged and the host report is tracked. Run a normal Compose shutdown/start without deleting the named database volume; compare data and health after restart. A fatal file or DB error must exit nonzero rather than expose a healthy API.

## Out of Scope

- The optional large UTM reference dataset, invented replacement data, automatic geometry repairs, latitude/longitude swaps, and automatic restoration of Soft-deleted sites.
- Site and survey CRUD, maps, authentication, user interfaces, exports, and later project steps.
- Additional permanent services, a root npm workspace, a new shared package, and production credential or deployment work.

## Further Notes

- The existing schema enforces active-only Site code uniqueness. The importer deliberately applies a stricter reserved-code policy to historical Soft-deleted sites.
- The Step 2 implementation specification remains the detailed acceptance and Definition of done checklist. Mark items complete only after observed checks; report verified import counts and rejection reasons rather than guessing from source files.
- Follow the `step-2:` commit convention after implementation and verification. Do not start Step 3 automatically.
