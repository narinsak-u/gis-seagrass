# 01: Build the Survey API

**What to build:** API consumers can list, create, update, and permanently delete Surveys for active Sites. Validate spatial, date, cover, and species data; persist Survey/species changes atomically; return current Site status after create/update.

**Status:** resolved

- [x] Implement `GET /sites/:code/surveys` with page/pageSize validation, 20-item default, maximum 100, and deterministic `surveyed_on DESC, id DESC` ordering.
- [x] Implement `POST /sites/:code/surveys` requiring coordinates, date, cover, and species. Return `201` with flat Survey fields and top-level `siteStatus`.
- [x] Implement `PATCH /surveys/:id` with nonempty partial bodies, immutable Site association, paired coordinate updates, and `200` response with top-level `siteStatus`.
- [x] Implement `DELETE /surveys/:id` as an atomic hard delete of species links and Survey, returning `204` without a body.
- [x] Reject unknown fields and malformed/non-positive IDs with `400 VALIDATION_ERROR`; return `404` for missing Sites or unknown Surveys using the agreed codes.
- [x] Validate finite WGS84 coordinates and inclusive 50-meter PostGIS geography distance; return `422 OUTSIDE_SITE` beyond the limit.
- [x] Validate strict real `YYYY-MM-DD` dates against Thailand's current date, and finite 0–100 cover representable at two decimals without rounding.
- [x] Validate every species code; allow empty arrays and normalize duplicates to one association. Omitted PATCH fields remain unchanged; `note: null` clears the note.
- [x] Derive status from the mean cover of all Surveys on the latest date, using agreed thresholds and `no_data` for no Surveys. Do not cache status.
- [x] Use transactions and the same per-Site `FOR UPDATE` lock as Site/import writes so geometry and active-Site invariants survive concurrent changes.
- [x] Extend real HTTP/PostGIS integration tests for route contracts, errors, validation, persistence, status, and concurrency. Assert observable responses and final database invariants.
- [x] Verify OpenAPI/Swagger schemas and update the root README only with verified behavior.

## Comments

Implemented on `step-4/survey-api`. The isolated backend/PostGIS suite passed 48/48 tests; the rollback-only schema check passed. Swagger UI was visually checked with all four Survey operations.
