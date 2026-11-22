# Step 2 — Seed Data Import & Validation

**Project phase:** Step 2 — Seed Data. **Prerequisite:** Step 1 completed and committed. **Commit prefix:** `step-2:`.

## Objective

Import the four user-supplied seed files into PostgreSQL/PostGIS safely, preserve originals, reject invalid records with an auditable CSV report, and make repeated runs idempotent. Do not implement CRUD endpoints or UI in this Step.

## Application boundary

The importer belongs exclusively to `backend/` (e.g. `backend/src/import/` or `backend/scripts/import.ts`). Its dependencies are installed and managed using `backend/package.json` and `backend/package-lock.json`. The four original files are committed unchanged in `backend/seed-data/`; the API container reads them through a read-only bind mount. The importer must **not** depend on a monorepo package, root workspace, or `frontend/` code. Docker Compose remains the sole root orchestration command.

**Manual import:** `cd backend && npm run import` (ensure the input path and DB connection are configured). **Container import:** `docker compose exec api npm run import` (or the documented equivalent command). Both execute the same import implementation.

## Inputs and ordering

```text
backend/seed-data/
  provinces.geojson
  species.json
  seagrass_sites.geojson
  surveys.csv
```

Import in the exact order: **provinces → species → sites → surveys**. The optional large UTM reference dataset (`seagrass_large_utm.zip`) is out of scope for this phase. Do not fabricate replacement data or hard-code accepted/rejected counts; compute them at runtime.

## Requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S2-01 | One documented CLI command (`cd backend && npm run import` or equivalent) | REQUIRED |
| S2-02 | `docker compose up` automatically imports after DB is ready / migrations complete | REQUIRED |
| S2-03 | Idempotent rerun: `sites.code`, `surveys.survey_ref`; no duplicate rows or data clobbering | REQUIRED |
| S2-04 | Reject invalid geometry, duplicate source code (keep first), non-importable site reference, irrational coordinates, >50 m from site, cover outside 0–100, future Thai-local date, unknown species | REQUIRED |
| S2-05 | Reject invalid rows without auto-repair (no lat/lon swap, no geometry repair) | REQUIRED |
| S2-06 | Write `import_report.csv` containing source filename, row/feature position, and reason | REQUIRED |
| S2-07 | `area_rai` computed with `ST_Area(geom::geography) / 1600`, rounded to 2 decimals | REQUIRED |
| S2-08 | GiST indexes for **all geometry columns**; verify indexes migrated in Step 1 | REQUIRED |
| S2-09 | Shared pure validation/domain rules suitable for future Site/Survey APIs | DECISION |
| S2-10 | `survey_species` link rows instead of raw Postgres text[] | DECISION |

## File handling and validation

### Provinces (`provinces.geojson`)

- Parse FeatureCollection; require properties `code`, `name_th` and Polygon/MultiPolygon coordinates consistent with WGS84 lon/lat.
- Reject invalid, empty or malformed geometry; normalize valid Polygon → MultiPolygon only as a representation conversion, not a repair.
- Duplicate codes **within source**: keep first and report later occurrences.
- Existing DB keys from a previous run: skip without overwriting.
- Save `geometry(MultiPolygon,4326)`.

### Species (`species.json`)

- Require an array of records with nonempty `code`, `name_th`, `name_sci`.
- Duplicate codes within the source: keep first, reject later; preexisting DB records: skip without overwrite.
- The supplied file contains species master data; do not invent additional codes.

### Sites (`seagrass_sites.geojson`)

- Require GeoJSON Feature with nonempty `code` and `name`.
- Allow Polygon/MultiPolygon but persist as MultiPolygon with SRID 4326.
- Reject invalid or empty geometry using PostGIS `ST_IsValid`, `ST_IsValidReason` (don't call `ST_MakeValid` automatically).
- Coordinates ordered `[lon, lat]`; reject out-of-range/malformed coordinates, rather than silently swapping values.
- Must intersect a province with **positive overlapping area** (touch-only does not count as area). Derive `province_code` from the province with largest geographic intersection area; use deterministic tie-break by province code.
- Compute `area_rai = ROUND((ST_Area(geom::geography)/1600)::numeric,2)` on the server.
- Duplicate `code` within source: retain first, reject subsequent records.
- Initialize `version=1`, audit timestamps, nullable `created_by` / `updated_by` for imported data.
- Skip any site code already in the DB even if a later file revision differs, including soft-deleted sites; count it as `skipped_existing` without overwriting or restoring it. Surveys referring to a soft-deleted site are rejected as `SITE_NOT_FOUND`, because only active sites are importable. Record this reserved-code policy in `DESIGN.md`; restoring a site requires an explicit action outside Step 2.

### Surveys (`surveys.csv`)

- Parse UTF-8 using a real CSV parser (handle quoting). Preserve original physical line or record number in the report, with header line accounted for.
- Required columns: `survey_ref`, `site_code`, `lon`, `lat`, `surveyed_on`, `cover_percent`, `species`.
- Unique `survey_ref` within CSV: keep first occurrence, reject duplicates. If already imported from a previous run, skip without overwriting.
- `site_code` must point to a successfully imported/existing active site, not merely any code appearing in source.
- Parse finite lon/lat in valid WGS84 range; create `ST_SetSRID(ST_MakePoint(lon,lat),4326)`.
- Validate `ST_DWithin(survey_point::geography, site_geom::geography, 50)`; exactly 50 m is allowed. Use PostGIS as authoritative spatial validator.
- `cover_percent` must be finite and in inclusive range 0–100.
- `surveyed_on` is strict valid `YYYY-MM-DD` and `<= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date`; do not compare with UTC day.
- Split species string on `|`, validate every resulting code exists in `species` table. Reject entire row on unknown/empty species code; don't silently drop unknown codes.
- Save survey and its `survey_species` rows atomically in one transaction. `note`, `photo_key` and audit user fields nullable for imports.

## Import orchestration / failure handling

```text
Compose DB healthy
       ↓
API startup preflight: migrations
       ↓
Import CLI: provinces → species → sites → surveys
       ├─ accepted → validate → transactional insert
       ├─ existing ID → skip (no overwrite)
       └─ invalid → append rejection with file/row/reason
       ↓
Write import_report.csv (including empty header-only report if none)
       ↓
API starts listening; health may return OK
```

- Keep **three core Compose services** (`db`, `api`, `web`). The API startup script can execute migrations and import sequentially before serving, with the same command callable manually from `backend/`. Mount `backend/seed-data/` read-only and keep the report accessible on the host. Do not introduce a workspace/root script or shared workspace package.
- Expected invalid data must be **reported and skipped**, not crash the whole import. Infrastructure failure, unreadable files, malformed file-level structure or database error should fail nonzero and block first startup.
- Use parameterized SQL. Avoid giant single all-or-nothing import transactions if one bad record should not block good records. Each survey + junction rows must be atomic.
- Ensure concurrent import instances do not race. `[DECISION]` Serialize the import via Postgres advisory lock (or another documented exclusive DB lock) and rely on unique constraints as last line of defense.
- For each file track `inserted`, `skipped_existing`, `rejected`; only rejections go to `import_report.csv`.

## Import report contract

Output path is `./reports/import_report.csv`, stable, documented and accessible outside ephemeral Docker container filesystems. CSV must at least contain `file,row,reason`, optionally `reference` and `details`. Use proper CSV escaping and UTF-8. Row numbering must be documented: CSV physical/record line (header = 1); GeoJSON feature positions start at 1. Repeated imports should not silently erase the **original rejection evidence**: write a fresh report for the current source validation pass including source-internal errors, while distinguishably skipping already imported valid rows.

Potential reason codes (report codes are implementation choices, not mandatory HTTP API codes): `INVALID_GEOMETRY`, `DUPLICATE_CODE`, `OUTSIDE_COVERAGE`, `SITE_NOT_FOUND`, `INVALID_COORDINATES`, `OUTSIDE_SITE`, `INVALID_COVER`, `FUTURE_DATE`, `UNKNOWN_SPECIES`, `DUPLICATE_SURVEY_REF`.

## Tests and verification

- Unit test parsers for malformed JSON/CSV, quoted CSV, duplicate identities, required fields, strict dates, invalid numeric values and species split.
- Integration test PostGIS invalid/self-intersecting polygon rejection without repair; polygon overlap province assignment and geographic area.
- Integration test survey 30 m away accepted, 200 m away rejected, and a point at exactly the 50 m boundary (use geospatially reliable test fixtures/tolerance).
- Cover -1, 0, 100, 101; yesterday, today Bangkok, tomorrow Bangkok; known and unknown species.
- Verify correct FK relationships and atomic insert of survey + species links.
- Run import twice; compare table counts and representative row values. No valid row should be overwritten or duplicated.
- Confirm `import_report.csv` has source filename, feature/row position and reason; verify reject counts from the actual files, not a hard-coded expected total.
- Run `docker compose down` then `docker compose up`; verify data persists and import is repeatable.
- Do not run `docker compose down -v` as a normal restart / validation command; that destroys the persistent DB volume.

## Definition of done

- [ ] Single import command documented and runnable from `backend/` locally or in the API container.
- [ ] Compose runs migration and import before serving API.
- [ ] Four source files imported in mandated order; invalid rows rejected without repair.
- [ ] Spatial validation uses PostGIS and geographic units; area stored in rai.
- [ ] Source duplicates handled deterministically; existing rows skipped.
- [ ] `import_report.csv` generated on host with accurate file/row/reason.
- [ ] Repeat import and service restart leave counts and values unchanged.
- [ ] Unit and DB-backed integration tests pass.
- [ ] Root README explains import, report, reruns and limitation/decisions.

## Git instructions for this Step

1. Verify Step 1 is committed; inspect `git status` before editing.
2. Implement only Step 2. Commit the four originals in `backend/seed-data/` unchanged and keep imports read-only. Ensure `import_report.csv` (a submission deliverable) is tracked, but do **not** commit credentials or unneeded DB volumes/logs.
3. Run tests and inspect actual imported counts/rejected reasons. Record **verified** results in README; don't hardcode them in application code.
4. Stage only Step 2 files and commit with e.g. `git commit -m "step-2: implement idempotent GIS seed import"`.
5. Report commit hash, import counts, report location, tests and any unresolved limitations. Stop until the user requests Step 3.
