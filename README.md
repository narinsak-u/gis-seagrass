# Seagrass Monitoring

PostGIS-backed API and map for seagrass Sites, Surveys, and survey history. The repository has separate `backend/` and `frontend/` npm projects. Docker Compose runs both with PostGIS and a Caddy gateway.

## Architecture

```text
Browser → Caddy → Next.js
                 └→ /api → NestJS → Drizzle → PostgreSQL/PostGIS
```

Caddy serves the web app and forwards `/api/*` requests to NestJS after removing `/api`. The frontend groups UI and data access by feature. Axios handles HTTP requests, Zod validates API responses, TanStack Query manages server data, and Zustand holds workspace and session state.

The NestJS backend uses `domain/`, `application/`, `infrastructure/`, and `presentation/` layers in the auth, sites, and surveys features. `site-survey-workflows/` coordinates transactions that span Sites and Surveys. The standalone importer reuses those write rules without starting NestJS. Startup applies migrations and imports seed data before opening the API.

## Technology stack

| Area | Technologies |
|---|---|
| Runtime and language | Node.js 22, TypeScript |
| Backend | NestJS, Drizzle ORM, PostgreSQL, PostGIS |
| Frontend | Next.js, React, MapLibre GL, Tailwind CSS |
| Frontend data and state | Axios, Zod, TanStack Query, Zustand |
| Gateway and local services | Docker Compose, Caddy |
| Testing and linting | Vitest, Playwright, Oxlint |

## Project structure

```text
.
├── backend/
│   ├── src/
│   │   ├── auth/                 # Authentication and access control
│   │   ├── sites/                # Site and Province APIs
│   │   ├── surveys/              # Survey API and status queries
│   │   ├── site-survey-workflows/ # Cross-feature transactions
│   │   ├── import/               # Seed parsers and importer
│   │   ├── platform/             # Database, health, HTTP, errors
│   │   └── shared/               # Shared application and spatial code
│   ├── seed-data/                # Imported source files
│   └── tests/                    # Unit and PostGIS integration tests
├── frontend/
│   ├── src/
│   │   ├── app/                  # Next.js routes and providers
│   │   ├── features/             # Auth, map, sites, surveys, provinces
│   │   └── lib/                  # Shared API client
│   ├── e2e/                      # Playwright tests
│   └── scripts/                  # E2E support scripts
├── gateway/                      # Caddy reverse proxy
├── docs/adr/                     # Architecture decisions
├── specs/                        # Feature specifications
├── .github/workflows/            # Path-scoped CI
├── docker-compose.yml
├── .env.example
├── DESIGN.md
└── README.md
```

Backend and frontend are separate npm projects with independent manifests and lockfiles.

## Run locally

```sh
cp .env.example .env
```

Set a private `JWT_SECRET` of at least 32 characters in `.env`, then start the stack:

```sh
docker compose up --build --wait -d
```

Open <http://localhost:8080>. The API health endpoint is <http://localhost:8080/api/health>; Swagger UI is at <http://localhost:8080/api/docs>.

API startup applies migrations, imports seed data, optionally seeds development accounts, then starts the server. Compose enables development account seeding. The database and gateway bind to loopback; Caddy is the only browser-facing entry point.

Stop the stack without deleting its database:

```sh
docker compose down
```

Never add `-v` unless you intend to erase the database volume.

## Seed data

The importer reads `backend/seed-data/` and serializes runs with a PostgreSQL advisory lock. It inserts new records, skips existing identities without overwriting them, and reports rejected rows in `reports/import_report.csv`.

Run it again with:

```sh
docker compose exec api npm run import
```

For a host-shell import, set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`. The local npm process does not load Compose’s `.env`.

## Accounts and access

Development accounts are inserted only when `SEED_DEVELOPMENT_ACCOUNTS=true`. Existing accounts are not reset.

| Role | Email | Password |
|---|---|---|
| Viewer | `dev-viewer@example.test` | `dev-viewer-password` |
| Editor | `dev-editor@example.test` | `dev-editor-password` |
| Admin | `dev-admin@example.test` | `dev-admin-password` |

Use these credentials and the example signing secret only for local development. Do not enable development account seeding in deployments.

Site browsing is public. Survey history requires a Viewer, Editor, or Admin account. Site and Survey writes require an Admin. Protected requests check the user’s current active status and role. Access tokens expire after 15 minutes.

Login example:

```sh
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev-viewer@example.test","password":"dev-viewer-password"}'
```

The response contains a Bearer access token. Login is limited to 20 attempts per 60 seconds per client IP. The limit is in-memory and resets when the API restarts.

## API and data rules

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /api/sites` | Public | Search and paginate active Sites |
| `GET /api/sites.geojson?bbox=minLon,minLat,maxLon,maxLat` | Public | Sites in a WGS84 map viewport |
| `GET /api/sites/:code` | Public | Site geometry and latest Survey summary |
| `GET /api/provinces.geojson?bbox=...` | Public | Provinces in a WGS84 map viewport |
| `GET /api/sites/:code/surveys` | Viewer, Editor, Admin | Paginated Survey history |
| `POST /api/sites`, `PATCH /api/sites/:code`, `DELETE /api/sites/:code` | Admin | Create, update, or retire a Site |
| `POST /api/sites/:code/surveys`, `PATCH /api/surveys/:id`, `DELETE /api/surveys/:id` | Admin | Create, update, or delete a Survey |

Sites use soft deletion; their codes remain reserved, and Sites with Surveys cannot be deleted. Site creation and geometry updates require valid geometry with positive-area overlap with a Province. Updates require the current Site version; stale versions return `409 VERSION_CONFLICT`.

Survey locations must be within 50 meters of their Site. Dates cannot be in the future in Thailand. Cover must be 0–100 with at most two decimal places. Species codes must exist. Site and Survey writes serialize where needed to preserve these rules.

Site status is calculated from the average Survey cover on its latest survey date: `very_good`, `good`, `fair`, `poor`, or `no_data`. Errors use `{ "error": { "code": "...", "message": "...", "details": {} } }`.

## Map

The map loads Sites and Provinces for the current viewport. Search, filters, and pagination apply only to the loaded Sites, not a nationwide catalogue. Selecting a table row zooms to its Site; selecting a polygon opens its details.

Sign in to view Survey history and plot its loaded observation points. The map uses OpenFreeMap tiles and needs network access. The UI is read-only; Site and Survey editing, dashboards, and exports are not included.

## Development and tests

Install and build each app independently:

```sh
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
npm --prefix frontend run build
```

Run tests:

```sh
npm --prefix backend run test:unit
npm --prefix frontend test
```

Backend integration tests need `IMPORT_TEST_DATABASE_URL` set to a disposable PostGIS database. Run them with `npm --prefix backend run test:integration`. Frontend lint uses `npm --prefix frontend run lint`.

Playwright E2E uses an isolated Compose project and database volume. From `frontend/`, install Chromium with `npx playwright install chromium`, then run `npm run test:e2e`. It does not use or stop the development stack.

GitHub Actions runs backend unit tests and frontend tests for changes in their respective directories. CI does not run PostGIS integration tests or Playwright E2E.