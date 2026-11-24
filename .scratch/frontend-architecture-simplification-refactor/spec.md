Status: ready-for-agent

# Frontend Architecture Simplification Refactor

## Problem Statement

The map, viewport table, Site details, Survey history, and sign-in work, but the frontend duplicates request and session state across custom controllers, hooks, and stores. Its Fetch client trusts unvalidated API responses. This makes ordinary changes harder to reason about and creates a concrete risk: protected Survey data can be reused across account switches because history cache keys omit the session. Invalid viewport bounds can also become a world-bounds geometry request, and overlapping Survey pages are not deduplicated in the production view.

## Solution

Keep the existing public map and protected Survey experience while giving each kind of state one owner. Use a single Axios transport boundary, Zod validation for consumed responses, TanStack Query for remote data, Zustand for shared UI and memory-only authentication, and MapLibre for rendering and interactions. Replace redundant request controllers in small coherent changes. The only approved user-visible corrections are rejecting invalid viewport bounds instead of fetching worldwide geometry and deduplicating Survey history by Survey ID. Do not implement as part of publishing this spec.

## User Stories

1. As a public visitor, I want the Site map to open without signing in, so that I can browse monitored seagrass areas.
2. As a public visitor, I want the Province layer limited to my viewport, so that the map stays relevant to where I am looking.
3. As a public visitor, I want Site geometry limited to my viewport, so that a map movement does not fetch nationwide geometry.
4. As a public visitor, I want an invalid map viewport to trigger no world-bounds request, so that a transient map error cannot load excessive geometry.
5. As a public visitor, I want the viewport table and map to show the same filtered Sites, so that selecting an entry matches what the map displays.
6. As a public visitor, I want Province, Site status, and search filters to work within the current viewport, so that I can narrow results without changing the map/table contract.
7. As a public visitor, I want table pages to use the Sites already loaded for my viewport, so that paging does not fetch an unrelated national list.
8. As a public visitor, I want a table row to zoom to its Site and a polygon click to select that Site, so that both navigation paths agree.
9. As a public visitor, I want Site details and their current Site status without signing in, so that public information stays available.
10. As a public visitor, I want loading, empty, error, and retry states to remain clear, so that I know whether the current map view has data.
11. As a public visitor, I want rapid panning to show results for the latest settled viewport, so that an older response cannot replace my current view.
12. As a public visitor, I want the same basemap, attribution, five Site status colors, selection highlight, and popup behavior, so that the refactor does not change map meaning.
13. As a keyboard user, I want the existing map/table and dialog controls to remain usable, so that I can navigate without a pointer.
14. As a mobile visitor, I want the map, filters, table, and details usable at 375px, so that smaller screens retain the same workflow.
15. As a viewer, editor, or admin, I want Survey history fetched only after I select a Site, so that protected requests happen only when needed.
16. As an authorized viewer, I want Survey history in newest-first order with a working next-page and retry control, so that I can inspect older observations.
17. As an authorized viewer, I want duplicate Survey IDs across pages shown once, so that history counts and Survey points do not repeat observations.
18. As an authorized viewer, I want a partial-coverage indicator based on unique loaded Surveys versus the reported total, so that I do not mistake loaded points for complete history.
19. As an authorized viewer, I want Survey points derived only from loaded history pages, so that the map does not imply unseen observations were loaded.
20. As a signed-out visitor, I want a Survey sign-in prompt without losing the public map, so that I can still browse Sites.
21. As a signed-in user, I want login followed by the current identity check, so that the UI uses my active backend role.
22. As a signed-in user, I want my token kept only in tab memory, so that reload starts anonymous and no browser storage or URL retains it.
23. As a signed-in user, I want logout to immediately hide Survey history and points, so that protected content does not linger.
24. As a user switching accounts, I want the previous account's Survey requests canceled and cached results removed before the new account appears, so that protected data cannot cross sessions.
25. As a user whose session expires, I want a current-session 401 to clear protected data and offer sign-in while leaving the public map available, so that I can recover safely.
26. As a newly signed-in user, I want an old session's late 401 or late login response ignored, so that it cannot log me out or restore stale credentials.
27. As a signed-in user without permission, I want a 403 permission state without forced logout, so that I can keep using permitted features.
28. As a user facing a malformed server response, I want an explicit error rather than missing data silently appearing as empty or no data, so that failures are visible and retryable.
29. As a maintainer, I want one owner for each remote or shared UI state, so that future changes do not require tracing parallel request controllers.
30. As a maintainer, I want transport and response contracts checked at the API boundary, so that UI code does not need to handle raw Axios responses or malformed payloads.

## Implementation Decisions

- Preserve the separate Next.js/React frontend, feature-first organization, existing gateway, MapLibre, Tailwind, TanStack Query, and Zustand. No backend, schema, migration, RBAC, or gateway change.
- Use one Axios client with same-origin `/api` base URL, JSON Accept header, timeout, `params`, and `AbortSignal`. API functions return validated values or normalized errors, never raw Axios responses. Keep the existing backend error codes and `ApiClientError` fields; use `NETWORK_ERROR` for transport failures and `INVALID_API_RESPONSE` for success-payload schema failures. Cancellation must not show as a network error; HTTP 204 has no response body to parse.
- Pass tokens explicitly at protected feature API boundaries. The shared client adds Bearer authorization only when given a token. Login's `/auth/me` uses the newly issued token before session publication; public requests never receive credentials. Do not persist, log, refresh, or put tokens in query keys or URLs.
- Parse consumed Site, Province, Survey, login, and current-identity response shapes with Zod. Infer wire types where possible, keep API field names, reject malformed required fields, enums, pagination, coordinate shape, and non-finite values. Check shape rather than polygon topology; PostGIS remains authoritative for geometry validity. Avoid duplicate type definitions and expensive topology checks.
- TanStack Query owns viewport Site and Province collections, Site detail, and paginated Survey history. Key viewport requests by normalized `[minLon,minLat,maxLon,maxLat]` bounds and relevant filters; do not request until bounds are valid. Settle/debounce map movements near the current 250ms behavior, pass Query cancellation to Axios, and prevent old responses from replacing the current viewport. Province changes update the Site query, not Province geometry filtering.
- Keep `status=active` as the public API filter for non-deleted Sites. Keep Site status as the separate assessment derived from Surveys (`very_good`, `good`, `fair`, `poor`, `no_data`). Filter Province, Site status, and search client-side against one current-viewport Site collection shared by map and table; retain client-side pagination.
- Continue Site detail loading through Query. Use one infinite query for Survey pages. Advance using response pagination, deduplicate loaded Surveys by ID while keeping newest-first order, derive points from unique loaded items, and mark partial coverage when unique loaded count is below the reported total even if there is no next page.
- Include a memory-only session epoch, Site code, and page size in protected Survey query keys, never the raw JWT or email/role alone. Cancel and remove protected queries on logout, current-session 401, identity changes, and account switching before exposing a replacement session. Ignore late responses and 401s from prior sessions. A 403 leaves authentication intact.
- Consolidate authentication into one memory-only Zustand owner for token, identity, auth status, and sign-in UI. Preserve login then `/auth/me`, immediate logout, anonymous reload, and public access. Keep only limited provider effects for protected Query cache coordination; do not retain a second event/subscription controller.
- Keep one MapLibre instance with symmetric listener and popup cleanup, unique sources/layers, existing layer order, basemap, attribution, selection, fitBounds, and interactions. Extract cohesive layer/event helpers only when they reduce competing responsibilities. Keep the workspace as composition root and avoid new state managers or component libraries.
- Retire custom viewport and Survey request controllers only after confirming production consumers and moving any still-used pure helpers or types. Replace their implementation-oriented tests with behavior coverage. Migrate in small coherent slices; temporary Fetch/Axios coexistence is allowed only during migration.
- Record the accepted transport/state ownership decision in the frontend ADR. Update current architecture and setup documentation after implementation, without rewriting historical Step 6 or Step 9 specs. Use `refactor:` commits for verified implementation and stop before Step 7.

## Testing Decisions

- Test externally observable behavior: requests sent through the gateway, visible map/table/detail/history state, role boundaries, pagination, cancellation effects, and normalized error outcomes. Do not assert internal controller names, number of hooks, source text, or incidental file layout.
- Primary seam: extend the existing Playwright workflow against its isolated disposable Compose project, real frontend, Caddy, API, and PostGIS. Check initial/panned bounded Site and Province requests; shared map/table filtering; row and polygon selection; basemap/attribution/status colors; loading/error/retry; keyboard and 375px behavior; authorized history and sign-out. Never run E2E against live project data.
- Focused deterministic seam: reuse the existing API-client Vitest tests and Query observer tests with a mock Axios adapter or injected transport for URL, params, headers, signal, 204, backend envelope, cancellation, network failures, schema errors, and accepted/rejected payloads. Reuse feature tests for valid/invalid BBOX, rapid-pan races, duplicate Survey IDs across pages, unique-count partial coverage, and session/account-switch races; migrate old Fetch/controller fixtures rather than pinning deleted implementations.
- Auth tests must cover login then `/auth/me`, anonymous refresh, stale login and stale 401 after account replacement, 401 cache/point eviction, and 403 without logout. A test that only checks a token field or a key's shape is insufficient; assert which identity can actually see protected Survey data.
- Verify once with frontend lint, TypeScript typecheck, unit tests, build, and the isolated browser suite. Record commands and any unexecuted checks as unverified. Review the resulting diff for backend, gateway, schema, and Step 7 scope creep. Do not claim performance gains without before/after measurement.

## Out of Scope

- Backend API/RBAC/schema/migration changes, Caddy or deployment-topology changes, CORS workarounds, nationwide geometry requests, and a new Next.js proxy.
- Step 7 map editing, exports, dashboards, new authentication flows, token persistence or refresh, retries of non-idempotent mutations, new form or component libraries, and polygon topology validation in the browser.
- Ticket splitting or implementation as part of publishing this specification.

## Further Notes

- The current frontend already uses Query for Site detail and Survey history, but still uses custom viewport controllers and a parallel auth session controller. The old Survey request controller is not a production pagination owner; its state types are still imported.
- Two intentional behavior corrections were approved: do not turn invalid bounds into world bounds; deduplicate overlapping Survey pages.
- The accepted frontend architecture ADR records the Axios choice and state ownership. The authoritative detailed refactor document and the implemented Step 6/Step 9 contracts remain the source for endpoint shapes and acceptance cases. This local spec is the ready-for-agent tracker entry, not permission to start implementation now.
