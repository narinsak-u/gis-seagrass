# 02: Persist and verify the Step 1 schema

**What to build:** A developer restarts the API and gets the complete Step 1 database schema through versioned migrations. Database queries prove that geographic records and their relationships follow the agreed constraints, and a temporary record survives a service restart without deleting the volume.

**Blocked by:** 01: Start PostGIS and verify live API health.

**Status:** resolved

- [x] Versioned migrations create users, provinces, species, sites, surveys, and survey_species before the API accepts requests.
- [x] Users have UUID keys, unique email, password hash, timestamps, and role restricted to viewer, editor, or admin.
- [x] Provinces and species have the specified codes and names; province geometry is MultiPolygon with SRID 4326.
- [x] Sites have bigint identity keys, province references, MultiPolygon geometry with SRID 4326, area, positive version defaulting to 1, nullable creator/updater references, timestamps, and nullable deletion timestamp. Only active site codes are unique.
- [x] Surveys have bigint identity keys, restricted site references, nullable unique survey references, Point geometry with SRID 4326, survey date, 0–100 cover percent, nullable note/photo and creator/updater references, and timestamps. Removing a site cannot cascade-delete its surveys.
- [x] Survey species use a composite survey/species key with both foreign keys.
- [x] Catalog or behavior checks verify required foreign keys, check constraints, active-code and present-reference uniqueness, GiST indexes for all three geometry columns, and the descending survey site/date/id index.
- [x] Running migrations again succeeds without duplicate DDL.
- [x] A uniquely identified temporary row survives a Compose service restart without volume deletion; clean up only that row afterward.
- [x] Live API health continues working after the schema migration.
