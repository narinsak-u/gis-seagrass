# Seagrass Monitoring

## Development stack and seed import

Copy example configuration, then start the database, API, web, and Caddy gateway:

```sh
cp .env.example .env
docker compose up --build --wait -d
```

Set a private `JWT_SECRET` of at least 32 characters in `.env` for deployments; the example value is for local development only. Compose enables development-account seeding explicitly.

API startup applies migrations, imports the four files in `backend/seed-data/`, seeds only missing development accounts, then listens internally. Open the app and API through Caddy at <http://localhost:8080>; API health is <http://localhost:8080/api/health>.

To run the same importer manually:

```sh
docker compose exec api npm run import
(cd backend && npm run import)
```
For a host-shell import, set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` to the reachable database; Compose's `.env` is not loaded by the local npm process.

The importer serializes runs with a PostgreSQL advisory lock and skips existing identities without overwriting records. It reports inserted, skipped-existing, and rejected counts per source. The host report is `reports/import_report.csv`; its `file,row,reason` rows identify source positions (GeoJSON features start at 1; survey positions include the CSV header). Each run writes evidence for that run's rejected rows.

Verified Compose startup summary: provinces `{inserted:0,skipped_existing:3,rejected:0}`, species `{inserted:0,skipped_existing:6,rejected:0}`, sites `{inserted:0,skipped_existing:27,rejected:3}`, surveys `{inserted:274,skipped_existing:0,rejected:26}`. Resulting database totals were 3 provinces, 6 species, 27 Sites, 274 surveys, and 543 `survey_species` links. These are observed results, not application constants. The report lists Site feature positions 9 and 19 as `INVALID_GEOMETRY`, and position 30 as `DUPLICATE_CODE`. Its 26 survey rejections include `UNKNOWN_SPECIES`, `OUTSIDE_SITE`, `INVALID_COORDINATES`, `INVALID_COVER`, `SITE_NOT_FOUND`, and `FUTURE_DATE`, with each source position in the CSV.

Re-running import skips existing records and revalidates source errors. Restart the full stack without deleting its named volume:

```sh
docker compose down
docker compose up --build --wait -d
```

`docker compose down` preserves the database volume; never add `-v` unless you intend to erase it. Site CRUD and spatial reads are implemented in Step 3. Development accounts are enabled only by the development Compose configuration.

## Login and development accounts

The local Compose stack seeds these accounts only when `SEED_DEVELOPMENT_ACCOUNTS=true`. Startup inserts missing accounts and never resets existing credentials, roles, or active flags:

| Role | Email | Password |
| --- | --- | --- |
| viewer | `dev-viewer@example.test` | `dev-viewer-password` |
| editor | `dev-editor@example.test` | `dev-editor-password` |
| admin | `dev-admin@example.test` | `dev-admin-password` |

Use these credentials only on a local development stack. Do not enable account seeding or use the example signing secret in deployments. `JWT_SECRET` is required before API startup and must be set privately outside development.

```sh
curl -X POST 'http://localhost:8080/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev-viewer@example.test","password":"dev-viewer-password"}'
```

Success returns `access_token`, `token_type: "Bearer"`, and `expires_in: 900`. Login errors use the shared `{ "error": { "code": "...", "message": "...", "details": {} } }` envelope.

Only `POST /api/auth/login` is limited: 20 attempts per 60 seconds per client IP. Caddy overwrites `X-Forwarded-For`; NestJS trusts one proxy hop. The in-memory limit resets on API restart and is not shared across replicas.

| Action | Anonymous | Viewer | Editor | Admin |
| --- | --- | --- | --- | --- |
| Site map, list, detail, and Site status | Read | Read | Read | Read |
| Survey list | `401` | Read | Read | Read |
| Create, update, or delete Sites and Surveys | `401` | `403` | `403` | Write |

Protected routes check the current account role and active flag on each request, before looking up a Site or Survey. Missing, malformed, expired, invalid, disabled-user, or deleted-user tokens return `401 UNAUTHORIZED`; insufficient roles return `403 FORBIDDEN`. Malformed JSON returns `400 VALIDATION_ERROR` before authentication. All errors use the shared envelope.

## Step 3 Site API

The API provides Site list/search, GeoJSON bbox reads, detail, create, versioned update, and soft delete. Reads omit soft-deleted Sites. Site boundaries may overlap; create and geometry updates require positive-area Province overlap. Geometry updates cannot leave linked Surveys more than 50 meters from the Site. API errors use `{ "error": { "code": "...", "message": "...", "details": {} } }`. An authorized stale PATCH returns `409 VERSION_CONFLICT` with the current Site PATCH GeoJSON Feature at `error.details.current`; exactly one of two concurrent PATCH requests using the same version succeeds.

Every public Site list item, GeoJSON feature property, and Site detail feature property includes `siteStatus`: `very_good`, `good`, `fair`, `poor`, or `no_data`. It is derived from the mean cover of all Surveys on the Site's latest observation date; earlier Surveys do not affect it. Sites without Surveys return `no_data`. The value is computed from current Survey data and updates after Survey creation, update, or deletion. Site reads remain public and add no status filter; POST and PATCH response shapes are unchanged.

Start the stack as above, then try these read-only requests:

```sh
curl 'http://localhost:8080/api/sites?page=1&pageSize=2'
curl 'http://localhost:8080/api/sites.geojson?bbox=99,7,100,8'
curl 'http://localhost:8080/api/sites/TRG-001'
```

Run unit and isolated PostGIS integration tests:

```sh
(cd backend && npm test)
```

`npm test` builds the backend and runs unit and PostGIS integration suites. Database-backed tests skip unless `IMPORT_TEST_DATABASE_URL` points to a disposable PostGIS database. Swagger UI is at <http://localhost:8080/api/docs>; OpenAPI JSON is at <http://localhost:8080/api/docs-json>. These API routes are available only through Caddy.

## Step 4 Survey API

Survey routes list observations for an active Site, create observations, partially update them, and hard-delete them. List items include nullable `created_by` as the creator's user ID. Imported Surveys may have no creator. Lists use `page` and `pageSize` (default 1 and 20; maximum page size 100), sorted by survey date then ID descending. Survey IDs are decimal strings. POST and PATCH return the Survey fields plus `siteStatus`, derived from the mean cover of all Surveys on the latest date. DELETE returns `204` without a body.

Coordinates use WGS84 longitude/latitude. A Survey point must be inside or within 50 meters of its Site, measured with PostGIS geography. Dates cannot exceed today in Thailand; cover must be from 0 to 100 and representable at two-decimal precision without rounding. Species codes must exist; duplicate codes become one association. Writes to a Survey and its species links are atomic and serialize with Site geometry edits/deletion. Site and Survey inserts store `created_by` and `updated_by` from the admin token; successful updates set `updated_by` and `updated_at`, including species-only Survey edits and Site soft deletion. Client-supplied audit fields cannot impersonate actors. Survey hard deletion leaves no retained actor record. Password hashes and signing secrets are never returned.

```sh
TOKEN="$(curl -s -X POST 'http://localhost:8080/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev-viewer@example.test","password":"dev-viewer-password"}' | jq -r .access_token)"
curl 'http://localhost:8080/api/sites/TRG-001/surveys?page=1&pageSize=20' \
  -H "Authorization: Bearer $TOKEN"
ADMIN_TOKEN="$(curl -s -X POST 'http://localhost:8080/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev-admin@example.test","password":"dev-admin-password"}' | jq -r .access_token)"
curl -X POST 'http://localhost:8080/api/sites/TRG-001/surveys' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"lon":99.538168,"lat":7.330521,"surveyed_on":"2025-03-08","cover_percent":62.2,"species":["TH","CR","EA"],"note":null}'
curl -X PATCH 'http://localhost:8080/api/surveys/123' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"cover_percent":50}'
curl -X DELETE 'http://localhost:8080/api/surveys/123' \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The POST example uses an existing Survey point and species codes from the committed seed data; it creates a separate Survey without an import reference. The ID `123` is illustrative; use an ID returned by POST. Swagger UI at `/docs` documents the routes and bearer security.

Compose defaults are development-only: database user `seagrass`, password `seagrass_dev_only`, database `seagrass`. Do not use these credentials outside local development. Override them privately in ignored `.env`, based on `.env.example`; never commit secrets.

## Step 6 map workspace

The web app at <http://localhost:8080> provides public Site browsing with an OpenFreeMap Liberty basemap, Province boundaries, status-colored polygons, synchronized filters and table, and Site detail with the latest public Survey summary. Site and Province geometry requests use the current map viewport's bounding box; table search and pagination cover only the currently loaded viewport's Sites, not a nationwide catalogue. Selecting a row zooms to its Site; selecting a polygon opens its detail.

Sign in with one of the development accounts above to see the current email and role and read protected Survey history for the selected Site. Survey points come only from loaded history pages. Tokens stay in tab memory and are passed explicitly to protected API calls; logout or `401` clears protected Survey data, and session epochs isolate history across account changes. Public browsing remains available after sign-out. `GET /provinces.geojson` requires a WGS84 `bbox`; `GET /auth/me` returns the active user's email and role.

The map depends on OpenFreeMap's third-party tile service, provided without an availability guarantee; it needs network access. Step 6 is read-only: Site/Survey editing, dashboards, and exports are not included.
At 375px viewport width, the Site table supports keyboard selection and opens Site detail.

### Isolated Playwright E2E

The E2E command builds and starts real web, API, and PostGIS services from the committed seed files under a unique Compose project and named database volume. It publishes only the gateway on loopback (default `18080`), uses test-only DB credentials and JWT secret, keeps the seed directory read-only, and removes only that project and volume on exit.

Install browser binaries once, then run from `frontend/`:

```sh
npx playwright install chromium
npm run test:e2e
```

Set `E2E_GATEWAY_PORT` if port `18080` is occupied. The command is repeatable and does not use or stop the development Compose project. Playwright HTML reports, traces, screenshots, and the isolated import report stay in ignored `frontend/playwright-report/` and `frontend/test-results/`; inspect them after failures. The browser supplies an empty local MapLibre style, so application layers and map interactions do not depend on OpenFreeMap uptime.

E2E inserts viewer, editor, and admin accounts with unique per-run credentials after the disposable database starts; development accounts are disabled. E2E covers public map and viewport reads, synchronized filters/details/history, viewer login/logout, admin Survey creation through the API plus UI history readback, and editor-role `403` authorization. Step 6 has no mutation UI; no Site or Survey mutation controls are added.

## CI workflows

GitHub Actions runs backend unit tests when `backend/**` changes and frontend Vitest tests when `frontend/**` changes. Each workflow also runs when its own workflow file changes. PostGIS integration and Playwright E2E remain local checks.

Run the same test commands locally:

```sh
(cd backend && npm run test:unit)
(cd frontend && npm test)
```

CI does not build or publish Docker images, deploy, or run PostGIS integration or browser E2E tests.


Frontend stays feature-first: UI lives in each feature's `components/`, feature hooks in `hooks/`, and feature contracts stay in their feature modules. Axios provides the shared same-origin `/api` transport, 10-second timeout, cancellation, and normalized errors; feature API boundaries use Zod to parse Site, Province, Survey, and authentication responses. TanStack Query owns server-data fetching, cancellation, and caching. Zustand owns shared Site-workspace filters, pagination, and selection, plus authentication session state; tokens remain explicit request arguments, stored only in tab memory and never in query keys or persistent storage. Survey query keys include a session epoch to isolate account changes; logout and `401` clear protected Survey cache.

Frontend tests use Vitest `describe`/`it`/`expect` and live in `src/features/<feature>/tests/`; shared library tests live in `src/lib/tests/`.

Run frontend tests, lint, and build:

```sh
cd frontend
npm test
npm run lint
npm run build
```


## Build applications independently

```sh
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)
```

## Backend tests

`cd backend && npm test` builds the backend, then runs `.unit.spec.ts` and `.integration.spec.ts` Vitest projects serially. `npm run test:unit` runs unit tests without PostGIS; `npm run test:integration` requires `IMPORT_TEST_DATABASE_URL` pointing at disposable PostGIS. CI runs only backend unit tests.

```sh
docker run --rm --name seagrass-step2-test \
  -e POSTGRES_USER=seagrass_test \
  -e POSTGRES_PASSWORD=seagrass_test_only \
  -e POSTGRES_DB=seagrass_test \
  -p 127.0.0.1:55432:5432 \
  postgis/postgis:16-3.4
```

Keep the container running, then run in another terminal:

```sh
cd backend
IMPORT_TEST_DATABASE_URL=postgresql://seagrass_test:seagrass_test_only@127.0.0.1:55432/seagrass_test npm run test:integration
```

The container has no persistent volume. Stop it after tests; `--rm` removes its database. `.env.example` records the test URL separately from Compose development settings.


## Disposable Compose verification

`docker-compose.verify.yml` isolates gateway smoke checks from development: use a unique Compose project and named database volume, loopback-only database and gateway ports, and a temporary host report directory. The API and Web have no published host ports.

Run from the repository root. Choose unused ports if defaults are occupied:

```sh
export VERIFY_PROJECT="gis-seagrass-step9-$(date +%s)"
export VERIFY_DB_VOLUME="${VERIFY_PROJECT}-db"
export VERIFY_REPORT_DIR="$(mktemp -d)"
export VERIFY_DB_PORT=55433 VERIFY_GATEWAY_PORT=38080
dc() { docker compose --project-name "$VERIFY_PROJECT" -f docker-compose.yml -f docker-compose.verify.yml "$@"; }

dc config
dc up --build --wait -d
curl --fail http://127.0.0.1:$VERIFY_GATEWAY_PORT/api/health
cat "$VERIFY_REPORT_DIR/import_report.csv"
dc down --volumes --remove-orphans
rm -rf "$VERIFY_REPORT_DIR"
```

The unique project, explicit volume name, and temporary report directory keep development resources untouched. `down --volumes` is safe here only because it targets this disposable project and its unique volume; never use it for the development project.



## Database checks

Rerun ordered Drizzle migrations while Compose is up:

```sh
docker compose exec api npm run migrate
```

Run the rollback-only schema check:

```sh
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/tests/platform/schema.sql
```

The check rolls back its temporary data. The database port defaults to `localhost:5432`; published ports bind to loopback by default.