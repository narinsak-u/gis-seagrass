# Step 9 — Gateway, E2E Testing & CI

**Project:** Seagrass Monitoring System  
**Status:** Confirmed for implementation — decisions recorded in section 10; implementation and verification pending  
**Prerequisites:** Steps 1–6 implemented and verified; Step 7/8 are optional and are not prerequisites  
**Commit prefix:** `step-9:`

## 1. Objective

Improve the project's deployment entry point and confidence in existing user workflows. Implement **only** these workstreams:

1. **Stock Caddy** as the sole browser-facing reverse proxy for frontend (`/`) and backend (`/api/*`), replacing the Next.js API proxy. Keep the existing JSON `UPSTREAM_UNAVAILABLE` response for proxy failures.
2. **NestJS login throttling** on `POST /auth/login` only, plus **Playwright E2E** for representative Steps 1–6 flows, without polygon drawing or editing.
3. **GitHub Actions CI** for path-scoped frontend tests and **backend unit tests only**, without Docker image builds, pushes, deployments or CD.

Keep the two independent npm applications (`frontend/`, `backend/`) and Docker Compose. No monorepo tooling, Redis, custom Caddy build, Caddy rate limiter, tiles routing, Playwright map-drawing tests, image build CI, or PostGIS-backed tests in CI.

## 2. Requirements and traceability

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| S9-01 | Caddy is the single browser-facing entrypoint for the web and API | Gateway `/` serves web and `/api/health` reaches backend through one origin |
| S9-02 | Route `/` → web and `/api/*` → api, preserving expected API routes and methods | Routing smoke tests for GET, POST/PATCH, and `/api/docs` |
| S9-03 | Throttle only `POST /auth/login` in NestJS at 20 attempts per 60 seconds per client IP | The next attempt returns `429` in the API error envelope; other routes are not throttled |
| S9-04 | Preserve auth, error envelopes and same-origin browser API calls through Caddy without the Next.js API proxy | Browser calls reach Nest directly; existing 401/403 and JSON `UPSTREAM_UNAVAILABLE` 502 remain intact |
| S9-05 | Playwright exercises core implemented Steps 1–6 flows | Scenarios in section 4 pass against isolated stack with imported seed data |
| S9-06 | E2E fixtures/resources isolated from development and production | Test-only Compose project, volumes, ports, users; cleanup only owned resources |
| S9-07 | Backend CI runs on backend-relevant changes; frontend CI on frontend-relevant changes | Changed-path scenarios and successful test logs |
| S9-08 | CI runs npm installs and tests only; no image build/push/deploy | Review workflow YAML and job logs |
| S9-09 | Document setup, verification commands, limitations; implement `step-9:` commits | README, specs / DESIGN notes, commit history |

## 3. Workstream 9.1 — Caddy Gateway

### 3.1 Routing contract

Only two upstreams are configured: `web:3000` and `api:3000`. Do not add a `/tiles/*` matcher, placeholder response, upstream, or documentation for a tile route.

| Incoming path | Destination | Expected handling |
| --- | --- | --- |
| `/` and non-API frontend paths | `web:3000` | Next.js handles app pages/static assets |
| `/api/*` | `api:3000` | Strip **only** `/api`; existing NestJS endpoints are rooted at `/sites`, `/auth`, `/health`, `/docs` |

- Keep browser/API requests on **one origin**, e.g. `http://localhost:8080` for local development. Existing frontend browser calls already use relative `/api/*` URLs.
- Publish only the gateway host port for browser access, bound to `127.0.0.1`; keep DB loopback access. API and Web remain internal to Compose. Standalone `next dev` can serve UI for frontend work, but API-backed flows require Caddy.
- Remove the Next.js API route, proxy implementation, its tests, and obsolete `API_INTERNAL_URL` wiring. `handle_path /api/*` strips `/api`; verify `/api` and `/api/` explicitly. NestJS has no global `api` prefix.
- Cover Next.js `/_next/*` and client-side routes through fallback routing to `web`; no special rewrite should break static assets.
- Use Caddy internal Docker DNS names, not `localhost`, to address `web` and `api` containers.
- Preserve WebSocket/streaming proxy semantics if any existing feature uses them.

### 3.2 Compose changes

- Add a fourth long-running service `gateway` to `docker-compose.yml`; the original `db`, `api`, `web` remain unchanged in responsibility. Update health/dependency wiring without introducing a deadlock.
- Add a Caddyfile with a pinned stock Caddy image; no custom gateway Dockerfile or plugin.
- Bind the configurable gateway host port to `127.0.0.1`. Do not publish API or Web ports; keep the DB port loopback-only for local tooling.
- Make startup/restart deterministic; after `docker compose up` and health/readiness, Web and API must be accessible through Caddy.
- Store no gateway state beyond what stock Caddy needs for local HTTP. The NestJS login limiter is in-memory and single-instance.

### 3.3 Login throttling and trusted client IP

Use `@nestjs/throttler` on **only** `POST /auth/login`: 20 attempts per 60 seconds per client IP, counting successful, failed, and malformed attempts. The next attempt receives HTTP `429` with the shared `{error:{code,message,details}}` envelope. Other POST/PATCH routes and GET/HEAD remain unaffected. JWT, RBAC and input validation remain authoritative.

Caddy overwrites incoming `X-Forwarded-For` with the actual connecting client IP. Configure NestJS/Express to trust exactly one proxy hop; do not trust caller-supplied forwarding headers. Do not publish the API host port. Validate two distinct client IPs where feasible and prove spoofed incoming headers cannot bypass the limit. Document that the default limiter storage is in-memory per API instance, resets on restart, and is not suitable for horizontally scaled API replicas without shared storage. Do not add Redis.

Caddy `handle_errors` returns the same JSON `UPSTREAM_UNAVAILABLE` 502 envelope as the removed Next.js proxy when the backend is unavailable; backend-generated 401, 403 and 429 responses pass through unchanged. Validate the actual stock Caddyfile before use.

### 3.4 Gateway verification

- `caddy validate --config ...` using the pinned stock gateway binary.
- `GET /` returns the Next.js page; `GET /api/health` returns the backend's real PostGIS status.
- `GET /api/docs` serves Swagger including its assets and API description through `/api/*`.
- Protected endpoint without token returns 401; with insufficient role returns 403.
- `POST /api/auth/login` works below the 20-per-60-second limit; the next attempt returns 429. Other API writes and GET requests are unaffected.
- An unavailable backend returns the JSON `UPSTREAM_UNAVAILABLE` 502 envelope from Caddy.

## 4. Workstream 9.2 — Playwright E2E for existing flows

### 4.1 Approach

Use Playwright (`@playwright/test`) against a **real running frontend, backend and PostGIS** via the Caddy origin. No mocked backend for critical paths. Use a known seed dataset and deterministic fixture IDs. Avoid selectors tied to UI styling; prefer roles, labels, and targeted `data-testid` attributes only where semantic locators are insufficient.

E2E files may live in `frontend/e2e/` with `frontend/playwright.config.ts` (or a dedicated `e2e/` folder **without adding a workspace**). Use npm scripts from `frontend/`.

Test environment must be isolated:
- Distinct Compose project name, named volumes, gateway port, database, test user credentials and import report path from normal development.
- No `docker compose down -v` on the default development project; cleanup only resources created for the E2E project.
- Verify no `external` volumes, shared bind mounts or fixed `container_name` collide with development.
- Seed via the existing import/startup pipeline; isolate expected data and tests to avoid order dependence.
- For state-changing tests, create uniquely identifiable disposable Site/Survey data and remove it or reset the **test-only** database between runs.
- Test output (`playwright-report`, `test-results`, traces/screenshots) is kept outside tracked source files and gitignored; retain failure artifacts when useful.

### 4.2 Minimum E2E scenarios

| Scenario ID | Existing capability | User flow / expected result |
| --- | --- | --- |
| E2E-01 | Step 6 public map | Open home page; map and status legend render; at least one Site polygon is displayed |
| E2E-02 | Steps 3 + 6 BBOX | Move map to another seeded province; network issues a new `/api/sites.geojson?bbox=...` request; no all-sites geometry download is used |
| E2E-03 | Steps 3 + 6 filters/table | Select province/status or enter query; table and map reflect the same eligible Sites; clicking row zooms to its polygon |
| E2E-04 | Steps 3, 4 + 6 details | Click a polygon; details open with Site name/status and Survey history after sign-in |
| E2E-05 | Steps 5 + 6 authentication | Log in as viewer; authenticated identity/role shown; no mutation controls exist; logout clears local session |
| E2E-06 | Steps 4, 5 + 6 survey mutation via API | Admin creates a disposable Survey through Playwright `request`; reload/requery the existing UI and observe the changed history/status |
| E2E-07 | Step 5 authorization | UI shows the editor role; Playwright `request` attempts an admin-only API mutation and receives 403 |

**Step boundary:** Step 6 exposes reads, login and role display, not Site/Survey mutation controls. E2E-06 and E2E-07 combine real API requests with UI observations; no Step 7 controls are added. Record this current UI limitation.
Other optional tests: pagination, empty state, error state, invalid login, and 375px responsive layout. Do not add polygon drawing/vertex editing/GeoJSON uploads or tests that assume those features exist. Login-throttle boundary verification is required under section 3.4.

### 4.3 Reliability rules

- Run tests sequentially when they mutate shared data, or give each test isolated fixtures. Avoid arbitrary `waitForTimeout`; wait for visible conditions and network assertions.
- Use Playwright locators by role/text, explicit network requests where verifying BBOX, and safe test-only credentials.
- Browser viewport should be stable and map basemap dependence handled explicitly (avoid assuming an external tile provider is always online; use a deterministic local tile fixture or validate application layers independently).
- Run E2E-06 via API write plus UI readback; do not mark it skipped because no mutation UI exists.
- Document how to run E2E, seed expectations, and how to clean up only disposable test resources.

## 5. Workstream 9.3 — GitHub Actions CI (tests only)

### 5.1 Scope

Implement **two independent workflows** or equivalently isolated path-scoped jobs:

| Changed paths | Runs |
| --- | --- |
| `backend/**` | Backend test workflow |
| `frontend/**` | Frontend test workflow |
| Both | Both test workflows |
| Docs-only (`README.md`, `specs/**`) | Neither, unless intentionally included in test-specific trigger list |
| Workflow config file | Its own workflow should run so configuration changes are validated |

Recommended files: `.github/workflows/backend-tests.yml`, `.github/workflows/frontend-tests.yml`. Trigger `push` and `pull_request`, using `paths` filters. Preserve independent behavior when both application directories change.

### 5.2 Backend CI

- `actions/checkout`, setup an appropriate pinned Node LTS, npm caching from `backend/package-lock.json`.
- `working-directory: backend` or explicit `cd backend`.
- `npm ci`, then `npm run test:unit` (the dedicated Vitest unit project). CI deliberately does **not** run `npm test` or `npm run test:integration`.
- No PostGIS service is required for unit CI. Keep DB-backed HTTP/import integration tests available for local disposable PostGIS verification and report their absence from CI explicitly.
- Job logs distinguish backend unit status from integration tests not run in CI; do not claim full backend coverage.
- Optional `npm run lint` / `npm run typecheck` only if configured and expected by the project's CI checks.

### 5.3 Frontend CI

- `actions/checkout`, setup pinned-compatible Node and npm caching from `frontend/package-lock.json`.
- `working-directory: frontend`.
- `npm ci`, `npm test` (or the project's actual frontend test script). Add lint/typecheck if scripts exist and are configured.
- **Do not automatically run browser E2E in this workflow** unless a deterministic full-stack test environment is intentionally added; Step 9 E2E tests are a separate local verification artifact. E2E may be a later manual workflow, but is not part of the required path-scoped unit CI.

### 5.4 Explicit exclusions

- **No** `docker build`, `docker compose build`, `docker buildx`, image upload, registry login, image tagging, deployment, CD or Watchtower.
- No global root npm workspace installation; `frontend/` and `backend/` each have their own `package.json` and `package-lock.json`.
- No external paid services or secrets necessary to run core CI.
- A CI workflow is not verified merely because YAML parses; inspect changed-file gating and a real green run when available. If remote GitHub Actions execution is not available, report it as unverified instead of claiming CI success.

## 6. Repository structure (suggested)

```text
seagrass-monitoring/
├── frontend/
│   ├── e2e/
│   ├── playwright.config.ts
│   ├── package.json
│   └── package-lock.json
├── backend/
│   ├── seed-data/         # existing immutable input
│   ├── package.json
│   └── package-lock.json
├── gateway/
│   └── Caddyfile         # stock pinned Caddy image; no plugin build
├── .github/workflows/
│   ├── backend-tests.yml
│   └── frontend-tests.yml
├── docker-compose.yml
├── docker-compose.verify.yml  # isolated project override reused for E2E
├── specs/
│   └── step-9-production.md
├── docs/
├── .env.example
├── README.md
└── DESIGN.md
```

**Naming:** `gateway` can be an additional Compose service; this does not convert the project into a monorepo or distributed services architecture.

## 7. Testing matrix

### Gateway
- Path routing `/`, `/api/health`, `/api/docs`.
- Prefix handling for `/api` and nested paths; Next.js assets unaffected.
- Authentication through proxy, no CORS regression on same-origin calls.
- Login throttling: 20 attempts per 60 seconds per client IP on `POST /api/auth/login` return 429; other routes unaffected; spoofed forwarding headers cannot bypass the limit.
- Config validation, JSON 502 on upstream failure, container restart, and health/readiness check.

### E2E
- E2E-01 through E2E-07 required; E2E-06/07 use real API requests plus UI observation without inventing Step 7 controls.
- No modification to seed files or development DB.
- Repeat execution produces the same result; clean after each isolated run.
- Screenshot/trace on failure; verify map actions through UI plus network/data assertions, not screenshots alone.

### CI
- Backend-only change triggers backend **unit** tests, not frontend tests.
- Frontend-only change triggers frontend Vitest tests, not backend tests.
- Both changes trigger both workflows.
- Workflow config changes trigger the corresponding workflow.
- Neither workflow builds or pushes an image.
- PostGIS integration and Playwright E2E tests run only during isolated local verification; report they are not covered by CI.

## 8. Implementation sequence

1. Inspect existing routes, frontend API base URL, Compose network and tests; inspect worktree and branch.
2. Record this confirmed design and focused Step 9 tickets in `.scratch/`; supersede the historical Step 6 Next.js proxy decision.
3. Add stock Caddy gateway and remove the Next.js API proxy; validate `/` and `/api/*` including Swagger assets and upstream 502.
4. Add NestJS login-only throttling, trusted client IP handling, and deterministic 429 verification.
5. Build isolated Playwright E2E tests against real Compose/PostGIS and run representative Steps 1–6 flows.
6. Add path-scoped backend-unit and frontend-test GitHub Actions workflows; validate changed-path behavior and obtain remote green evidence when available.
7. Update README, DESIGN and roadmap; run final local tests and E2E, recording actual results.
8. Independently verify against this spec, `.scratch/` tickets/decisions and code; fix findings and re-verify.
9. Commit verified units with `step-9:`; report hashes and evidence; stop.

## 9. Acceptance criteria / Definition of done

- [ ] Caddy is the documented single browser entrypoint; routing works for frontend and backend only.
- [ ] Only `POST /auth/login` is throttled in NestJS at 20 attempts/60 seconds/client IP; 429 envelope and trusted proxy IP are verified. No Caddy rate limiting is added.
- [ ] Existing browser authentication, role rules, `/api/docs`, API error envelopes and Site/Survey features remain functional through gateway.
- [ ] Playwright covers agreed Steps 1–6 user flows on an isolated and repeatable environment; no Step 7 map-drawing or geometry editing tests added.
- [ ] Tests don't modify the development/production database, seed inputs or unowned Docker volumes.
- [ ] Backend-unit and frontend-test GitHub Actions workflows trigger independently by changed paths; PostGIS integration and E2E remain documented local checks.
- [ ] CI does not build/push Docker images or deploy anything.
- [ ] README provides gateway/E2E/CI commands, login-throttle policy, test-only setup and known limitations.
- [ ] Verification evidence available; Git commits use `step-9:`.

## 10. Confirmed decisions

1. **Gateway:** stock pinned Caddy on loopback port 8080 routes `web:3000` and `api:3000`, strips `/api` once, removes the Next.js API proxy, and returns its JSON `UPSTREAM_UNAVAILABLE` 502 on upstream failure. API/Web have no published host ports.
2. **Login limit:** route-scoped NestJS throttler, 20 attempts per 60 seconds per client IP. Caddy overwrites forwarded IP; Nest trusts one proxy hop. In-memory state resets on restart; other API writes are not rate-limited.
3. **E2E:** Step 6 has no mutation controls. E2E-06 uses an admin API write plus UI readback; E2E-07 checks an editor API 403 plus visible UI role. Use isolated Compose, seed data and owned fixtures.
4. **CI:** backend `npm run test:unit` only and frontend `npm test`, path-scoped independently. PostGIS integration and browser E2E are verified locally, not claimed as CI coverage.

## 11. Git policy

All Step 9 commits start with `step-9:`. Examples:

```text
step-9: add stock Caddy gateway and NestJS login throttling
step-9: add Playwright E2E coverage for core flows
step-9: add path-filtered frontend and backend test CI
```

Do not commit real credentials, runtime reports, test database files, Playwright traces or temporary generated artifacts. Stop after Step 9; do not implement other production enhancements.
