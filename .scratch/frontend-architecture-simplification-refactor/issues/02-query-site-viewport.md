# 02: Keep viewport Site map and table synchronized

**What to build:** A visitor pans the map and sees only valid, current-viewport Site results in both map and table. Replace the Site viewport request controller with Query-backed Axios/Zod data while retaining shared client-side filters and pagination.

**Blocked by:** 01: Load validated public Site details.

**Status:** ready-for-agent

- [ ] Initial load and settled pan/zoom request bounded active Sites with deterministic `[minLon,minLat,maxLon,maxLat]` parameters; invalid bounds never trigger a world-bounds request.
- [ ] Site response geometry, properties, and Site status are validated; bad payloads show a retryable error rather than empty results.
- [ ] Rapid movements debounce near the existing interval, forward cancellation, and cannot let an old viewport response replace current results; fitBounds does not loop.
- [ ] Province filter changes the Site viewport request; Province, Site status, and search filters apply to the same current-viewport collection used by map and client-side paginated table.
- [ ] Row/polygon selection, public detail, loading/empty/error/retry, and existing visual status meaning remain intact; focused race tests and a disposable-browser workflow exercise the visible behavior.
- [ ] The old Site viewport request controller and its implementation-only tests are retired after any still-used pure bounds/filter helpers are retained.
