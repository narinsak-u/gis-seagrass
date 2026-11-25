# 02: Keep viewport Site map and table synchronized

**What to build:** A visitor pans the map and sees only valid, current-viewport Site results in both map and table. Replace the Site viewport request controller with Query-backed Axios/Zod data while retaining shared client-side filters and pagination.

**Blocked by:** 01: Load validated public Site details.

**Status:** resolved

- [x] Initial load and settled pan/zoom request bounded active Sites with deterministic `[minLon,minLat,maxLon,maxLat]` parameters; invalid bounds never trigger a world-bounds request.
- [x] Site response geometry, properties, and Site status are validated; bad payloads show a retryable error rather than empty results.
- [x] Rapid movements debounce near the existing interval, forward cancellation, and cannot let an old viewport response replace current results; fitBounds does not loop.
- [x] Province filter changes the Site viewport request; Province, Site status, and search filters apply to the same current-viewport collection used by map and client-side paginated table.
- [x] Row/polygon selection, public detail, loading/empty/error/retry, and existing visual status meaning remain intact; focused race tests and a disposable-browser workflow exercise the visible behavior.
- [x] The old Site viewport request controller and its implementation-only tests are retired after any still-used pure bounds/filter helpers are retained.

## Comments

- Implemented in `f1ba1d3`; targeted Vitest: 32 passed, typecheck and lint passed; isolated browser: 7 passed. Integration build and typecheck passed after removing stale generated Next dev route types.
