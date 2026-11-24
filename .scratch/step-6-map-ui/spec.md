Status: ready-for-agent

## Problem Statement

Visitors cannot browse monitored Sites in a usable map workspace. The frontend is a placeholder, while Site geometry, Site status, and protected Survey history are available only through separate API calls. The current API cannot provide Province boundaries or a signed-in user's current email and role. Nationwide Site list pages cannot truthfully represent the current map viewport.

## Solution

Provide a responsive MapLibre GL workspace with the OpenFreeMap Liberty basemap, visible attribution, active Site polygons, Province boundaries, and a synchronized viewport-bounded Site table. Keep Site browsing public. Provide sign-in, current email and role, Site detail, and authorized selected-Site Survey history and points. Add two bounded/read-only backend contracts needed by the workspace. Preserve the existing Site and Survey authorization and domain rules.

## User Stories

1. As a visitor, I want to browse active Site boundaries without signing in, so that I can find monitored seagrass areas.
2. As a visitor, I want a labeled basemap, so that I can orient myself around Sites.
3. As a visitor, I want Province boundaries, so that I can place Sites in their geographic context.
4. As a visitor, I want the map to load only my current viewport's Sites, so that browsing stays responsive.
5. As a visitor, I want map data to follow settled pans and zooms, so that the map reflects where I am looking.
6. As a visitor, I want rapid map moves not to trigger redundant loads, so that the interface remains usable.
7. As a visitor, I want a late response for an old viewport ignored, so that the map never jumps back to stale results.
8. As a visitor, I want Site polygons colored by current Site status, so that I can compare conditions.
9. As a visitor, I want a legend for `very_good`, `good`, `fair`, `poor`, and `no_data`, so that I can interpret colors without guessing.
10. As a visitor, I want `no_data` distinct from poor status, so that missing observations are not misrepresented.
11. As a visitor, I want a table of Sites in the current viewport, so that I can scan Site codes and names.
12. As a visitor, I want client-side table pages, so that a dense viewport remains navigable.
13. As a visitor, I want a Province filter shared by map and table, so that both views show the same area.
14. As a visitor, I want a Site-status filter shared by map and table, so that both views show the same assessment class.
15. As a visitor, I want case-insensitive Site code and name search shared by map and table, so that I can find a matching Site.
16. As a visitor, I want filters to apply only to viewport Sites, so that the table does not imply nationwide results.
17. As a visitor, I want to select a table row and zoom to its Site boundary, so that I can inspect its location.
18. As a visitor, I want to select a polygon and find its table row, so that map and list selection agree.
19. As a visitor, I want a selected Site highlighted, so that I can distinguish it from nearby Sites.
20. As a visitor, I want Site detail to show its identity and current status, so that I can confirm what I selected.
21. As a visitor, I want the latest Survey summary when available, so that I can see recent observations without signing in.
22. As a visitor, I want a sign-in prompt instead of protected Survey history, so that its access rule is clear.
23. As a viewer, I want to sign in and read the selected Site's Survey history, so that I can inspect observations.
24. As an editor, I want the same Survey read access, so that my role can inspect observations without editing.
25. As an admin, I want to read the selected Site's Survey history, so that I can inspect its observations.
26. As a signed-in user, I want to see my current email and role, so that I know which account is active.
27. As an authorized Survey reader, I want points for loaded selected-Site Surveys, so that I can locate observations.
28. As an authorized Survey reader, I want history paging to disclose partial point coverage, so that I do not mistake loaded points for all Surveys.
29. As a visitor, I want no Survey points exposed before authorization, so that protected locations remain private.
30. As a user, I want sign-out to remove protected Survey data and points, so that they do not remain visible to the next viewer.
31. As a user, I want a Site change to clear the previous Site's Survey points, so that locations are not attributed to the wrong Site.
32. As a user, I want an expired or invalid token to return me to sign-in while public Site browsing continues, so that auth failure does not blank the map.
33. As a user without Survey access, I want an access message rather than history, so that I understand a `403` response.
34. As a visitor, I want retryable map, Province, table, detail, and history failures, so that transient outages do not strand me.
35. As a visitor, I want visible loading and no-results states, so that empty views are not confused with stalled requests.
36. As a visitor, I want an explicit no-Survey-data state, so that a Site without observations is not mistaken for a failed load.
37. As a mobile visitor, I want the map workspace usable at 375 px without horizontal page overflow, so that I can browse on a phone.
38. As a keyboard user, I want labeled login, filters, table selection, detail close, and map/list controls, so that I can use the workspace without a pointer.

## Implementation Decisions

- Keep the frontend an independent Next.js application and implement a single map workspace; route browser API calls through a same-origin Next.js proxy under `/api/*` forwarding to server-side `API_INTERNAL_URL` (default local backend, `http://api:3000` in Docker Compose), preserving `Authorization` headers, status codes, and shared error envelopes without opening CORS on the backend. Use existing ADR-0002 flat backend feature boundaries and application contracts for new reads. No schema change: Province geometry and user email/role already exist in the database.
- Render with MapLibre GL and the single OpenFreeMap Liberty style at `https://tiles.openfreemap.org/styles/liberty`. Keep OpenStreetMap and OpenMapTiles attribution visible. OpenFreeMap is a third-party, as-is service without an availability guarantee; no bulk offline tile download.
- Fetch active Site GeoJSON by WGS84 viewport bbox in `minLon,minLat,maxLon,maxLat` order after initial load and settled map movement. Debounce moves and cancel or ignore superseded responses. `status=active` describes Site lifecycle, not the five-value `siteStatus` assessment.
- Add public `GET /provinces.geojson?bbox=...` inside the Sites feature (sharing Site bbox validation and flat ADR-0002 layers without adding an empty Province domain module): return a GeoJSON FeatureCollection sorted by `code` of intersecting Province MultiPolygons with `properties: { code, name_th }` matching Site `province_code`. Require valid WGS84 bbox using the existing Site bbox rules; do not expose an unbounded Province collection.
- Build map polygons and the table from the same current Site bbox response. Send Province selection to the Site bbox endpoint; apply Province, `siteStatus`, and case-insensitive code/name substring search consistently to both views. Populate Province dropdown options from the current viewport (retaining known options and the active selection while filtered, with an "All provinces" clear option, and enriching labels with `name_th` once Province boundaries are loaded). Paginate filtered viewport features locally. Do not use nationwide Site list pages to populate this table or fetch unbounded geometry for search.
- Fetch public Site detail on selection and show `latest_survey` when present. Selection is shared by polygon and row; row selection zooms/pans to the Site, and viewport changes replace the source features without retaining stale status.
- Keep the existing login request and token response. Add protected `GET /auth/me` inside Auth returning `{email,role}` for the current active database user by extending the authenticated actor lookup to include `email` and reusing the existing route guard. Invalid, expired, or inactive tokens return the shared `401` error envelope. Do not infer current role from the token or invent a person name.
- Keep the access token in tab memory only; never persist credentials. On logout or a protected `401`, clear token, identity, Survey history, and Survey points while preserving public Site browsing. A `403` shows an access message.
- Fetch protected Survey pages only for an authorized viewer, editor, or admin who opens a selected Site. Plot only `lon`/`lat` from loaded pages of that Site. Clear pages and points on Site change or lost authorization; make partial pagination visible. Never fabricate Province boundaries or Survey locations.
- Use the shared `{error:{code,message,details}}` envelope for API errors. Provide loading, retry, empty, no-history, mobile, and keyboard-accessible states. Site/Survey writes remain out of scope.

## Testing Decisions

- Test observable behavior and API contracts, not component structure, request-library internals, or implementation details. Reuse existing backend HTTP integration seams and the rendered browser workspace as the primary user-facing seam.
- Extend existing Site GeoJSON HTTP integration patterns to test Province bbox validation, boundary intersection, coordinate order, FeatureCollection shape, and exclusion outside the viewport. Extend auth HTTP integration patterns to test current email/role, missing/invalid/expired/inactive tokens, role changes, and the shared error envelope.
- Browser-test real map/table selection, filters, Site detail, login/identity, Survey role gates and point clearance, error/empty/loading states, and public browsing after token expiry. Check viewport requests and attribution at a 375 px viewport with keyboard navigation.
- Use focused deterministic client tests only for debounce and superseded-response ordering where browser timing is unreliable. Cover matching filter results and status legend through consumer-visible behavior at the workspace seam when practical.
- Existing backend prior art: Site GeoJSON and auth integration tests use a real Nest HTTP listener and isolated database fixtures. The frontend currently has no tests; add only tests that catch plausible user-visible failures.

## Out of Scope

- Site or Survey editing; map drawing; dashboards; exports; extra basemap styles; nationwide table search; unbounded geometry loads; persistent login; offline tile downloads; production availability or self-hosting guarantees.

## Further Notes

- This issue-tracker spec records the agreed Step 6 plan; the Step 6 implementation specification remains the source for detailed acceptance criteria and the `step-6:` commit convention. Do not mark implementation done before automated checks and browser verification.
- OpenFreeMap documents the style URL and MapLibre integration at https://openfreemap.org/quick_start/ ; its attribution and free-use policy are at https://openfreemap.org/ ; its as-is availability terms are at https://openfreemap.org/tos/ .
