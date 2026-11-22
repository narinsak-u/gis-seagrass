# 02: Read a Site with its latest Survey

**What to build:** API consumers can fetch an active Site as GeoJSON with a deterministic latest-Survey summary; missing or Soft-deleted sites remain hidden. The Feature representation can be reused by later spatial and write routes.

**Blocked by:** 01: List active Sites with shared API errors.

**Status:** resolved

- [x] `GET /sites/:code` returns `200` as a GeoJSON Feature with normalized MultiPolygon geometry in longitude/latitude order and Site summary properties matching the list contract.
- [x] Only detail adds `latest_survey`: null with no linked Survey, otherwise `survey_ref`, `surveyed_on` as `YYYY-MM-DD`, and numeric `cover_percent`; nullable references stay null.
- [x] The latest Survey sorts by `surveyed_on` descending, then Survey identity descending for same-date ties.
- [x] Missing or Soft-deleted sites return `404 SITE_NOT_FOUND` in the shared envelope.
- [x] Real HTTP/PostGIS tests cover geometry, fields, Survey absence, tie-breaking, and deleted/missing lookups.

## Comments

Merged `step-3/t02` at `9fe0da5545580fab15a44886b64cf7bbbb3ba5e7`. Parent reports 7 passing isolated HTTP tests.
