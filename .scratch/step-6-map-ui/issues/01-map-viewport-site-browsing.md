# 01: Map and viewport Site browsing

**What to build:** A visitor can open a usable MapLibre map, orient on the OpenFreeMap Liberty basemap, and browse current active Sites colored by Site status without signing in. The map requests only the current viewport and never replaces it with an older response.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A MapLibre map renders the OpenFreeMap Liberty basemap with visible OpenStreetMap/OpenMapTiles attribution and usable controls.
- [x] Initial load and each settled map pan or zoom request `/sites.geojson` via the same-origin Next.js `/api/*` proxy (forwarding to server-side `API_INTERNAL_URL`, including `Authorization` headers and shared error envelopes, without enabling CORS on NestJS) with WGS84 bbox coordinates ordered `minLon,minLat,maxLon,maxLat`; no unbounded Site geometry request occurs.
- [x] Rapid moves are debounced; superseded responses cannot replace newer Site features, including after request failures.
- [x] Active Site polygons use API `siteStatus` values `very_good`, `good`, `fair`, `poor`, and `no_data`; the legend matches and `no_data` has a distinct neutral style.
- [x] Map loading, empty, and retryable error states work while public browsing remains available.
- [x] Focused checks cover bbox ordering, settled movement, debounce, stale response handling, and visible status presentation; verify the rendered map in a browser.
