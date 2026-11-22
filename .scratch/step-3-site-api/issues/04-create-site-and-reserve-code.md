# 04: Create valid Sites and reserve historical codes

**What to build:** Editors can submit valid Site GeoJSON and receive server-derived province, area, and initial version. Duplicate codes, including codes on Soft-deleted sites, cannot be reused; invalid geography never persists.

**Blocked by:** 02: Read a Site with its latest Survey.

**Status:** ready-for-agent

- [ ] `POST /sites` accepts only a GeoJSON Feature with code/name properties and Polygon or MultiPolygon geometry; valid requests return `201` as a normalized MultiPolygon Site Feature with version 1.
- [ ] Reject malformed Feature/properties and unknown or client-derived fields with `400 VALIDATION_ERROR`; reject malformed, empty, invalid, or out-of-range geometry with `400 INVALID_GEOMETRY`, without repair or axis swap.
- [ ] Require positive-area overlap with a Province or return `422 OUTSIDE_COVERAGE`; choose greatest geographic overlap with province-code tie-break, and calculate numeric rai from geography rounded to two decimals. Site overlap remains allowed.
- [ ] A new database migration enforces permanent Site code uniqueness without deleting historical rows; active and Soft-deleted collisions return `409 DUPLICATE_CODE`.
- [ ] Real HTTP/PostGIS tests cover both geometry types, invalid/touch-only cases, province tie and area, allowed Site overlap, duplicate active/deleted codes, and migration behavior on existing rows.
