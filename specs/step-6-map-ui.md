# Step 6 — Map and Synchronized Site List

**Project phase:** Step 6 — Map and Synchronized Site List. **Prerequisites:** Steps 1–5 completed and verified. **Commit prefix:** `step-6:`. **Status:** Agreed specification; not yet implemented.

## Objective

Build a responsive, authenticated map workspace for browsing active Sites and their current status. The map, filters, search, and result table must stay in sync. Fetch map features only for the current viewport, and fetch protected Survey history only when an authorized user opens a Site.

## Scope

- Public Site map/detail/status reads from Step 5, plus Step 6 Province boundaries and current-user identity endpoints.
- Login and current-user email/role display.
- Map layers, viewport bbox requests, filters, search, selection, and Site detail with Survey history.
- Loading, error, empty, unauthorized, and responsive states.

Site/Survey editing, dashboards, exports, and additional basemap styles are outside this Step.

## API integration contract

- `GET /sites.geojson?bbox=minLon,minLat,maxLon,maxLat&province=&status=active` supplies active Site features for both map and viewport-bounded table. Send WGS84 bounds in longitude/latitude order after initial map load and after each settled map move/zoom. The `status` query parameter means active Site, not the `siteStatus` classification.
- `GET /provinces.geojson?bbox=minLon,minLat,maxLon,maxLat` is a new public Step 6 endpoint returning a GeoJSON FeatureCollection (sorted deterministically by `code`) of Province MultiPolygons intersecting the WGS84 bbox; each feature has `properties: { code, name_th }` with `code` matching Site `province_code`. Apply the same bbox validation as `/sites.geojson`; do not expose all Province geometry in an unbounded request.
- `GET /sites/:code` supplies a selected Site Feature and `latest_survey`.
- `GET /sites/:code/surveys?page=&pageSize=` supplies protected, paginated history including `lon` and `lat`. Send the login token as a Bearer token. Fetch only for a selected Site and an authorized viewer/editor/admin; show map points only for the selected Site's loaded history pages.
- `POST /auth/login` accepts `{email,password}` and returns `{access_token,token_type,expires_in}`. `GET /auth/me` is a new protected Step 6 endpoint returning `{email,role}` for the active token's current database user; it returns `401` for invalid, expired, or inactive tokens. Site reads remain public; failed login must not prevent public map browsing.
- Treat the shared `{error:{code,message,details}}` envelope as the source of API error messages. A `401` on identity or Survey history clears session authentication and opens sign-in; a `403` shows an access message.

## Functional requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S6-01 | Render a MapLibre map with the OpenFreeMap Liberty basemap, Site polygons colored by `siteStatus`, a status legend, authorized selected-Site Survey points, and viewport-bounded Province boundaries. | REQUIRED |
| S6-02 | Request `/sites.geojson` with the current map bbox after initial load and after map movement settles. Debounce viewport changes; cancel or ignore stale requests so a late response cannot replace newer viewport results. Never load all Site geometries in one request. | REQUIRED |
| S6-03 | Display a paginated viewport-bounded Site table with province and `siteStatus` filters plus text search. Table rows and map polygons reflect the same filters. | REQUIRED |
| S6-04 | Selecting a table row zooms/pans the map to that Site and selects/highlights its polygon. Selecting a polygon selects the matching table row and opens its detail panel. | REQUIRED |
| S6-05 | The detail panel shows Site identity and current status, latest Survey summary when available, and Survey history to authenticated viewer/editor/admin users. Anonymous users see an explicit sign-in prompt for history; roles without access never see protected Survey data. | REQUIRED |
| S6-06 | Provide a login form and show the authenticated user's email and current role from `/auth/me`. Keep the token only in memory for the current tab; handle expired/invalid tokens by returning to sign-in without hiding public map data. | REQUIRED |
| S6-07 | Show visible loading, recoverable error/retry, no-results, and no-Survey-data states for map, table, detail, and history requests. | REQUIRED |
| S6-08 | Support a 375 px viewport: filters, table, detail, login, legend, and map controls remain usable without horizontal page overflow. | REQUIRED |
| S6-09 | Provide accessible labels and keyboard-operable login, filters, table selection, detail close, and map/list controls. | REQUIRED |

## Filter and result behavior

- Apply province, `siteStatus`, and case-insensitive Site code/name search to the current `/sites.geojson` features for both map and table. Send province to `/sites.geojson`; its `status=active` is unrelated to the client-side `siteStatus` filter. Match the API's substring search semantics without calling nationwide `/sites`.
- Paginate the filtered viewport features in the client; do not fetch nationwide `/sites` pages or unbounded Site geometries. A table selection may move the map to that Site; after the viewport changes, use the new bbox response for both views.
- `siteStatus` colors and legend labels use the exact values: `very_good`, `good`, `fair`, `poor`, `no_data`. Include a distinct neutral style for `no_data`; do not infer status from a stale cached client value.
- Show Survey points only from loaded history pages for the selected Site while the user is authorized. Clear protected history and points on logout, token rejection, or Site change; paging may add points, but do not imply the points represent all Surveys until all pages are loaded.
- Fetch Province boundaries from `/provinces.geojson` for the current viewport. The basemap's administrative lines do not substitute for this layer.

## Implementation decisions

- **[DECISION]** Keep `frontend/` as an independent Next.js application with feature-based folders (for example `features/auth`, `features/map`, `features/sites`). Route browser API calls through a same-origin Next.js proxy under `/api/*` forwarding to server-side `API_INTERNAL_URL` (default `http://127.0.0.1:3000` locally, `http://api:3000` in Docker Compose), preserving `Authorization` headers, HTTP status codes, and `{error:{code,message,details}}` envelopes without enabling CORS on NestJS. Do not introduce a monorepo or shared workspace.
- **[DECISION]** Use MapLibre GL for the map. Add only the libraries needed for map rendering, API caching/request cancellation, and accessible UI primitives. Tailwind CSS and shadcn/ui are the preferred styling/component choices. Add Zustand only if shared state cannot stay local to the map workspace; avoid duplicating server data in global client state.
- **[DECISION]** Use the API's public Site status as the sole status source. Use one basemap: OpenFreeMap Liberty at `https://tiles.openfreemap.org/styles/liberty`. Keep MapLibre attribution visible for OpenStreetMap data and OpenMapTiles; the provider [requires attribution](https://openfreemap.org/) and [documents this MapLibre style URL](https://openfreemap.org/quick_start/). Its public service is free, including commercial use, but [provided without availability guarantees](https://openfreemap.org/tos/); do not use it for offline bulk downloads.
- **[DECISION]** Add the two bounded/read-only backend endpoints following ADR-0002's flat four-layer layout: place `GET /provinces.geojson` inside `sites/` (sharing bbox validation with `sites-geojson.controller.ts` without creating an empty `provinces/domain/` module) returning `{ code, name_th }` sorted by `code`; implement `GET /auth/me` inside `auth/` by including `email` on `AuthenticatedActor` and reusing `AuthGuard` so live active-user/role checks require no extra query. Populate Province filter options from the current viewport (retaining known options and the active selection while filtered, with an "All provinces" clear option, and enriching labels with `name_th` from `/provinces.geojson`). Build the table from current Site bbox features, not the nationwide list endpoint. Show only authorized selected-Site Survey history locations.

## Tests and verification

- Unit/component coverage for status colors/legend, filter synchronization, no-results/error/loading states, auth gates, and stale-request handling.
- API/client tests confirm bbox coordinates are sent in correct order, each settled viewport change produces a new bbox request, rapid moves are debounced, and superseded responses do not overwrite current data.
- Browser verification confirms row selection zooms to the Site; polygon selection opens the matching detail; province/status/search filters affect both views; Survey history and points are role-gated; expired tokens preserve public browsing. Verify the Province bbox and `/auth/me` contracts against the backend.
- Verify at 375 px width and with keyboard navigation. Confirm basemap attribution remains visible and Province/Survey layers display actual authorized geometries.

## Definition of done

- [ ] Map displays active Site polygons colored by `siteStatus`, a matching legend, Survey points, Province boundaries, and one basemap.
- [ ] Initial load and settled viewport changes request only the current bbox; requests are debounced and stale responses are ignored.
- [ ] Province, status, and search filters produce matching map and table results.
- [ ] Selecting a table row zooms to the Site; selecting a polygon opens its detail and history panel.
- [ ] Login, email/current-role display, and role-gated Survey history and points follow Step 5 authorization behavior plus the new `/auth/me` contract.
- [ ] Loading, error, retry, empty, and no-history states are handled.
- [ ] Layout works at 375 px and required controls are keyboard-accessible.
- [ ] Automated checks and browser verification pass; unverified criteria remain unchecked.
- [ ] Root README describes only verified frontend features and limitations.

## Git instructions for this Step

Implement only Step 6, including the two specified backend read endpoints. Verify the starting branch/worktree and prerequisite implementation, run the checks listed here, review the diff, stage only Step 6 files, and commit the completed verified unit with the `step-6:` prefix. Do not begin Step 7 automatically.
