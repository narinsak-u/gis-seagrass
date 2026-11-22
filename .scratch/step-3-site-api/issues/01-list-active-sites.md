# 01: List active Sites with shared API errors

**What to build:** API consumers can browse active Site summaries with deterministic pagination, province filtering, and case-insensitive code/name search. Invalid requests and unexpected failures return the shared JSON error envelope. This first slice establishes the real HTTP-to-PostGIS test seam for later routes.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `GET /sites` returns `200` with `items`, `total`, and `page`; each item has exactly `code`, `name`, `province_code`, numeric `area_rai`, and numeric `version`, without geometry.
- [x] Omitted or `active` status returns only active Sites; other status and invalid query values return `400 VALIDATION_ERROR`.
- [x] Province filtering and case-insensitive substring search over code/name work together; results sort by code, pages start at one, defaults are page 1/size 20, and size above 100 is rejected.
- [x] All failures use `{error:{code,message,details}}` with object details; malformed JSON uses `400 VALIDATION_ERROR`, unknown routes use `404 NOT_FOUND`, and unexpected failures use `500 INTERNAL_ERROR` without internal details.
- [x] Real HTTP tests against isolated PostGIS cover response fields, filtering, ordering, pagination boundaries, and shared error behavior; the existing health route remains usable.

## Comments

Parent verified successful build and 4 HTTP PostGIS tests. Fast-forward merged `step-3/t01fix` at `35ffc51a46e3c735ef354f50468130239528fdd0`.
