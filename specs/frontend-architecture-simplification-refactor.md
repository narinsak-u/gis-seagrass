# Frontend Architecture Simplification Refactor

**Project:** GIS Seagrass Monitoring System  
**Source:** `frontend/`
**Status:** Decisions confirmed — implementation not started  
**Work type:** Preparatory refactor (`refactor:` commit prefix), not Step 7  
**Primary change scope:** `frontend/` plus documentation; no backend feature work

## 1. Objective and existing pain points

Simplify the implemented Step 6 frontend while preserving its user-facing behavior, except for the explicitly approved invalid-BBOX guard and Survey-page deduplication. Use **Axios** for HTTP transport, **Zod** for validating consumed API responses, **TanStack Query v5** as the single owner of server state, **Zustand** for shared UI and in-memory session state, and **MapLibre GL** only for rendering and map interactions.

Observed code hotspots:

| Current file | Concern | Refactor outcome |
| --- | --- | --- |
| `src/lib/api.ts` | Custom Fetch abstraction; `apiFetch<T>()` casts unvalidated JSON | Axios client, normalized errors, Zod response schemas |
| `features/sites/viewport.ts` | Manual debounce, abort, request state | Settled/debounced BBOX + TanStack Query |
| `features/provinces/provinces-viewport.ts` | Parallel custom viewport request state | Same Query-based approach |
| `features/surveys/history-controller.ts` | Separate imperative pagination state machine; `useSurveyHistory` already uses `useInfiniteQuery` | Retire redundant controller after consumer audit |
| `features/auth/auth-session.ts`, `auth-store.ts`, `AuthProvider.tsx` | Custom event/subscription controller bridged into Zustand | Single memory-only auth store and limited provider/cache effects |
| `features/map/hooks/useSeagrassMap.ts` | Large hook mixing lifecycle, layers, events and popup | Split layer/event helpers without extra state managers |
| `features/sites/components/SitesWorkspace.tsx` | Many callbacks and mixed orchestration | Lean composition + focused hooks |

**Success means simpler ownership and maintainability, not a fixed line-count target.** Do not add abstractions merely to increase file count.

## 2. Existing contracts that MUST NOT change

The **implemented and verified** `specs/step-6-map-ui.md`, plus later Step 9 routing decisions, are authoritative. In particular:

1. Preserve separate `frontend/` Next.js 16 / React 19 application (own npm lockfile), feature-based structure, MapLibre GL, Tailwind CSS v4, Zustand and TanStack Query.
2. Browser requests continue using same-origin **`/api/*` via the Step 9 Caddy gateway**. Do not restore Step 6's original Next.js proxy, add CORS, change deployment topology, or hardcode browser backend hosts.
3. `GET /sites.geojson?bbox=...&province=...&status=active` fetches **only Site geometry in the viewport**. `status=active` means not deleted, whereas `siteStatus` is one of `very_good | good | fair | poor | no_data`.
4. The table is built from the **current viewport's Site features**, with **client-side** province/siteStatus/search filtering and pagination. Map and table must share the same filtered FeatureCollection. Do **not** replace this with nationwide `GET /sites` pages.
5. Province layer uses viewport-bounded `GET /provinces.geojson?bbox=...`; preserve single OpenFreeMap Liberty basemap and attribution.
6. Public users may browse Site/Province maps and Site details. Survey history is protected (viewer/editor/admin), fetched only when a Site is selected, and Survey points represent only loaded history pages.
7. Auth endpoints and shapes: `POST /auth/login` returns `{access_token,token_type,expires_in}`; `GET /auth/me` returns current `{email,role}`. Session token stays **only in process/tab memory** (no cookies/localStorage/sessionStorage/URL).
8. Preserve 401 => invalidate session and hide protected history/points, while preserving public map. 403 => permission state without spurious logout. Existing backend RBAC remains unchanged.
9. Preserve map/table selection, fitBounds, popup, current Site status colors, empty/loading/error/retry states, keyboard navigation, and 375px mobile behavior.
10. No backend schema/migrations/API changes, no new auth flows, no Step 7 editing, no exports/dashboard, no nationwide geometry fetch, no new component library required.

## 3. Target architecture and data flow

```text
frontend/src/
├── app/                      # Next.js routes and providers
├── lib/
│   ├── api-client.ts         # one Axios client
│   └── api-error.ts          # normalized transport/schema errors
└── features/
    ├── auth/
    │   ├── api.ts
    │   ├── schema.ts
    │   ├── store.ts          # single in-memory auth state owner
    │   └── components/
    ├── sites/
    │   ├── api.ts
    │   ├── schema.ts
    │   ├── queries.ts
    │   ├── state/workspace-store.ts
    │   ├── components/
    │   └── hooks/
    ├── provinces/
    │   ├── api.ts
    │   ├── schema.ts
    │   └── queries.ts
    ├── surveys/
    │   ├── api.ts
    │   ├── schema.ts
    │   ├── queries.ts
    │   └── components/
    └── map/
        ├── components/
        ├── hooks/
        ├── layers/           # pure-ish MapLibre source/layer helpers
        └── map-constants.ts
```

This is illustrative; **do not generate unused files or generic base classes**. Keep existing useful pure helpers/tests. Recommended dependency direction:

```text
React UI -> Feature Query Hook/Options -> Feature API -> Axios -> /api/* Caddy -> NestJS
                               |                 |
                         TanStack Query       Zod parse
Zustand = selected Site, filters, table page, auth/session UI (not fetched data)
MapLibre = map instance, sources, layers, events (not API requests)
```

| State | Single owner |
| --- | --- |
| Site/Province viewport GeoJSON, Site detail, Survey history | TanStack Query |
| Request loading/errors/retries/cancellation | TanStack Query + normalized `ApiClientError` |
| Selected Site, search, province, status, client table page | Existing Zustand workspace store |
| Token, current identity, sign-in open/status | One memory-only Zustand auth store |
| Settled map BBOX and mobile panel visibility | Local hook/component state |
| MapLibre `Map`, listeners, popup references | Map hook `useRef` + cleanup |

## 4. Axios HTTP boundary

- Add `axios` runtime dependency; create **one** client with `baseURL: '/api'`, reasonable timeout and JSON Accept header. Keep existing endpoint paths and server behavior.
- Use Axios `params` and `signal` rather than handcrafted URL serialization and AbortController managers.
- Normalize backend `{error:{code,message,details}}` to a compatible `ApiClientError` with `status`, `code`, `message`, `details`. Preserve recognized backend error codes, including 401/403; represent network failures as `NETWORK_ERROR` and response-schema failures as `INVALID_API_RESPONSE`.
- Handle HTTP 204 with no JSON parsing. Cancellation must not produce user-visible network errors.
- Pass the token explicitly at protected feature API boundaries; the shared Axios client sets the Bearer header for those calls only. `/auth/me` uses the login response token before it is stored; public calls send no credential. Never let a stale credential be reused after logout.
- No silent token refresh, persistent token storage, retrying non-idempotent mutations, browser-side CORS workaround or redirects in the transport layer.
- API functions must not return raw Axios responses or expose Axios errors to UI components.
- Use mock Axios adapters or dependency injection in tests; remove old `fetchImpl` knobs after their consumers/tests migrate.

## 5. Zod validation at network boundaries

- Add `zod` runtime dependency and parse all **consumed** success response shapes: Site GeoJSON/list-detail properties, Province GeoJSON, Survey history pages/items, login response, `/auth/me`, plus error envelope as needed.
- Infer transport types from schemas with `z.infer`; keep separate UI/domain-only types where appropriate. Preserve snake_case API names, including `siteStatus`, `area_rai`, `surveyed_on`, `created_by`, `access_token`.
- Reject unexpected required-field types, invalid enum values, invalid coordinate shapes/non-finite numbers and malformed pagination. Do not silently map malformed response to empty results or `no_data`.
- Keep GeoJSON validation proportional to viewport size; do not introduce expensive frontend polygon topology checks (PostGIS is authoritative). Profile if performance concerns arise.
- Validate **trusted schema shape**, not authorization: Zod does not replace backend guards. Do not log tokens or sensitive payloads on parse errors.
- Favor one authoritative schema for each API shape, not duplicate manual interfaces. Keep schema helpers readable; avoid gratuitous transforms or `z.any()`/unchecked casts.
- Zod request validation for the login form is optional; **do not add React Hook Form solely for this refactor**.

## 6. TanStack Query as server-state owner

### 6.1 Viewport queries

```text
Map load / moveend -> valid normalized BBOX -> ~250ms debounce -> query key
                         ├── sites viewport (bbox + province + status=active)
                         └── provinces viewport (bbox)
                     -> Zod-validated GeoJSON -> existing shared filters
                     -> map + client-side paginated table
```

- Maintain distinct keys for `sites/viewport`, `provinces/viewport`, and `sites/detail` with all relevant parameters; normalize BBOX deterministically in `[minLon,minLat,maxLon,maxLat]` order.
- `enabled` prevents requests until valid bounds are known. Reject invalid bounds instead of the current `normalizeBboxBounds()` world-bounds fallback; never silently request worldwide geometry.
- Use Query `AbortSignal` for Axios; rapid pan/zoom must not let stale responses replace the current viewport. `fitBounds` must not cause request loops.
- Keep loading, error, empty and retry UI behavior. Province change triggers an updated Site viewport request; Province geometry remains bbox-based.
- Filter `siteStatus` and search **client-side over the current viewport** consistently for map and table; keep client-side pagination. Do not fetch nationwide Sites.
- Existing pure BBOX formatting/filtering logic can stay; replace only the custom network lifecycle/state machine.

### 6.2 Selected Site and Survey history

- Preserve `useQuery` for Site details; consolidate duplicate query wrappers/mappers only if helpful.
- Make `useInfiniteQuery` the sole owner of Survey pages, retries and cancellation. Keep newest-first order; deduplicate loaded items by Survey ID before deriving authorized Survey points. Derive partial coverage from unique loaded items versus the reported total, even when no page remains; advance pages using response pagination rather than the deduplicated count.
- Audit production imports before deleting `surveys/history-controller.ts`. Retire obsolete imperative controller, keep small pure types/helpers elsewhere, and replace necessary behavioral tests.
- Survey history query keys include an in-memory session epoch, Site code and `pageSize`; **never include raw JWT**. `/auth/me` exposes email/role only, so identity is not a safe session key. Cancel and remove protected queries before publishing a replacement session.
- Cancel and remove protected queries on logout, unauthorized token, identity changes and account switching. Guard against late responses restoring protected data. 403 should not be treated as anonymous.

### 6.3 Query defaults

- Preserve sensible existing retry/no-refetch choices; decide `staleTime` per endpoint instead of a global refetch storm.
- Avoid duplicate `useEffect` request managers, imperative subscribe patterns, or copied Query results in Zustand.

## 7. Auth simplification

- Consolidate `auth-session.ts`, `auth-store.ts` and `AuthProvider.tsx` into **one owner** for token, auth status, identity and sign-in UI. A tiny provider for clearing protected Query caches is acceptable; do not run a second parallel session controller.
- Preserve login -> `/auth/me` sequence, memory-only token, immediate logout and public map access. Reload starts anonymous.
- Handle late login/`/auth/me` responses after logout via abort or session epoch guard (Axios/TanStack Query do not automatically solve all auth races).
- Never persist, log or expose JWT in query string, UI state debug tools or persistent storage.
- Normalize 401 once for requests belonging to the current session; a late 401 from an older session must not log out a newer account. Remove protected Survey cache and clear points; avoid redundant 401 handlers in every component. 403 remains forbidden without forced logout.

## 8. MapLibre/Workspace decomposition

- `useSeagrassMap.ts` retains ownership of MapLibre lifecycle. Move source/layer creation and data updates into focused `map/layers/{site,province,survey}-layer.ts` functions where this reduces complexity.
- Extract popup construction and pointer/click handlers if meaningful; do not introduce one React component per map layer.
- Preserve one map instance, `on/off` listener symmetry, `map.remove()` cleanup, source/layer uniqueness, selected Site highlighting, correct layer order, popups and attribution.
- `MapWorkspace.tsx` should compose Query-backed viewport requests with the Map component, rather than constructing custom viewport controllers.
- `SitesWorkspace.tsx` remains a composition root for filters/table/detail and event coordination; move cohesive logic to hooks only where it removes competing responsibilities and excessive callback plumbing.
- Keep 375px mobile UI, status legend, table keyboard operations, retry controls and map selection/zoom exactly as in implemented Step 6.

## 9. File-by-file migration plan

| Phase | Files | Work and verification |
| --- | --- | --- |
| 1 — Transport | `src/lib/api.ts`, tests | Axios client, error normalizer, API call migration; verify `/api/*`, params, cancellation and errors |
| 2 — Schemas | `features/{auth,sites,provinces,surveys}/types.ts`, `api.ts`, new `schema.ts` | Validate actual endpoint payloads and infer response types; reject malformed fixtures |
| 3 — Viewport | `sites/viewport.ts`, `provinces/provinces-viewport.ts`, `map/components/MapWorkspace.tsx` | Query-based BBOX, debounce, stale response handling, retry and shared client filtering |
| 4 — Detail/history | `sites/hooks/*`, `surveys/history-controller.ts`, `surveys/hooks/*` | Consolidate Query use and remove only genuinely redundant network controllers |
| 5 — Auth | `auth/auth-session.ts`, `auth/auth-store.ts`, `auth/components/AuthProvider.tsx` | One memory-only store, safe login/logout/account switch, protected cache eviction |
| 6 — Map/UI | `map/hooks/useSeagrassMap.ts`, `map/components/*`, `sites/components/SitesWorkspace.tsx` | Separate map layers/events and reduce workspace orchestration without changing UX |
| 7 — Closure | Tests, `package.json`/lockfile, root `DESIGN.md` and README; ADR if accepted | Regression, browser verification, documentation, independent verify |

**Migration rule:** Small coherent change sets; no rewrite of the whole frontend at once. Temporary Fetch/Axios coexistence is allowed only during migration, not the final state. Do not delete tests merely because an internal implementation has changed; replace with tests of the same observable behavior.

## 10. Regression and acceptance matrix

Run all safe frontend checks from `frontend/`:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run test
npm run build
npm run test:e2e
```

Run browser/E2E checks with the existing **isolated disposable** environment, not live project data. Record unexecuted checks as unverified, not passing.

| ID | Verification case | Evidence |
| --- | --- | --- |
| R-01 | Axios URL/params/Bearer/AbortSignal forwarding and 204 handling | Unit tests using mock adapter |
| R-02 | Backend envelope, network error, cancellation, 401/403 and malformed payloads | Typed normalized errors; no silent fallback |
| R-03 | Zod accepts real API fixtures and rejects invalid GeoJSON/status/Survey/Auth types | Schema tests |
| R-04 | Initial viewport and pan to another province send different bounded site/province queries | Network/Playwright assertions |
| R-05 | Rapid map pan/zoom debounces; old responses do not overwrite new viewport | Race/cancellation tests |
| R-06 | Province/siteStatus/search filters stay identical for map and **viewport table** | Shared filtered feature set tests |
| R-07 | Table pagination stays client-side and row click zooms to proper geometry | Unit/E2E |
| R-08 | Polygon click opens matching detail; selected Site stays consistent as map moves | E2E |
| R-09 | Survey history only for permitted identity and selected Site; pagination/partial points correct | Integration/E2E |
| R-10 | Logout/401/account switch cancels requests and clears protected cache; 403 does not log out | Race/security tests |
| R-11 | Auth token memory-only; refresh starts anonymous; stale login responses ignored | Auth unit/E2E |
| R-12 | MapLibre layers/listeners/popup not duplicated or leaked on updates/unmount | Unit/browser tests |
| R-13 | Basemap attribution and 5 status colors/legend remain correct | Browser validation |
| R-14 | Loading, empty/error/retry, keyboard controls and mobile 375px still work | E2E/manual evidence |
| R-15 | No backend, schema, Caddy routing or Step 7 feature changes | Diff review |

Optional before/after metrics: number of HTTP requests during rapid pan, amount of duplicated state, and production bundle output; **do not claim performance improvements without measurement**.

## 11. Confirmed decisions from `grill-me-with-docs`

1. **Transport:** Axios is required at the unchanged `/api/*` boundary.
2. **Bounds and history:** Invalid bounds never trigger a world-bounds request. Loaded Survey pages deduplicate by Survey ID. Both correct current frontend behavior.
3. **Error compatibility:** Keep `ApiClientError` (`status/code/message/details`); use `INVALID_API_RESPONSE` for schema failures.
4. **Auth headers:** Pass tokens explicitly from protected feature API calls to the shared Axios client. `/auth/me` receives the fresh login token before store publication; public calls stay unauthenticated.
5. **Protected Query keys:** Use an in-memory session epoch, Site code and page size, with cancellation and eviction on logout, 401, identity changes and account switches.
6. **Zod depth:** Validate required Feature/geometry shape and finite coordinates, not polygon topology; benchmark realistic viewport payloads.
7. **Legacy controllers:** Remove controllers without runtime consumers after moving useful types/helpers and replacing tests with observable behavior tests.
8. **Documentation:** Add an ADR for the transport and state ownership trade-off; update `DESIGN.md` and README after implementation without rewriting historical Step 6/9 specs.

Shared scope confirmed; do not implement or ticket until separately requested.

## 12. Definition of done

- [ ] A single Axios client serves current frontend calls at the unchanged `/api/*` gateway.
- [ ] Consumed API responses have runtime Zod validation; wire types are inferred when possible.
- [ ] Error normalization preserves backend codes and distinguishes network/cancel/schema cases.
- [ ] TanStack Query owns all Site/Province viewport, Site detail and Survey history remote data.
- [ ] Redundant custom async controllers are removed after consumer audit; regression coverage retained.
- [ ] One memory-only Zustand auth owner handles 401/logout/account changes securely.
- [ ] MapLibre layers/events and workspace orchestration are simplified without UX regression.
- [ ] Viewport-only map and client-side table remain synchronized; no unbounded geometry request.
- [ ] Protected Survey history and map points never leak across sessions.
- [ ] Existing responsive, keyboard, retry, empty/error/loading and map interactions continue working.
- [ ] No backend API/RBAC/schema, Caddy routing or numbered-step behavior changes.
- [ ] Lint, typecheck, unit, build and isolated browser tests are run with evidence; blockers disclosed.
- [ ] README/DESIGN/accepted ADR updated, diff reviewed, and independent `verify` passes.
- [ ] Verified work committed using `refactor:`; **stop before Step 7**.

## 13. Agent workflow and Git policy

```text
specs/frontend-architecture-simplification-refactor.md (this main spec)
    ↓ grill-me-with-docs; confirm decisions
.scratch/frontend-architecture-simplification-refactor/spec.md + tickets
    ↓ implement in small verified slices
lint + typecheck + Vitest + isolated Playwright
    ↓ independent verify skill
commit: refactor: ...
    ↓ stop; do not start Step 7
```

Preserve unrelated changes. Do not blindly stage the whole worktree, delete historical specs, overwrite user data, amend commits or force-push. Report executed commands, verified outcomes, commit hashes and remaining limitations.
