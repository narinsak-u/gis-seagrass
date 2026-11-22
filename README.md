# Seagrass Monitoring

## Development stack and seed import

Start the `db`, `api`, and `web` services:

```sh
docker compose up --build --wait -d
```

Compose waits for database readiness. API startup applies migrations, imports the four files in `backend/seed-data/`, then listens. Open the web app at <http://localhost:3001>; API health is at <http://localhost:3000/health>.

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

Startup repeats migrations and import before API readiness. `docker compose down` preserves the database volume; never add `-v` unless you intend to erase it. Site CRUD and spatial reads are implemented in Step 3; authentication and the map remain out of scope. Site codes remain reserved after soft deletion, Sites with Surveys cannot be deleted, and geometry edits preserve the 50-meter Survey distance rule. Writes are unauthenticated in this development step; do not expose the API to untrusted users.

## Step 3 Site API

The API provides Site list/search, GeoJSON bbox reads, detail, create, versioned update, and soft delete. Reads omit soft-deleted Sites. Site boundaries may overlap; create and geometry updates require positive-area Province overlap. Geometry updates cannot leave linked Surveys more than 50 meters from the Site. API errors use `{ "error": { "code": "...", "message": "...", "details": {} } }`.

Start the stack as above, then try these read-only requests:

```sh
curl 'http://localhost:3000/sites?page=1&pageSize=2'
curl 'http://localhost:3000/sites.geojson?bbox=99,7,100,8'
curl 'http://localhost:3000/sites/TRG-001'
```

Run unit and isolated PostGIS integration tests:

```sh
(cd backend && npm test)
```

`npm test` builds the backend and runs its tests. Database-backed tests skip unless `IMPORT_TEST_DATABASE_URL` points to a disposable PostGIS database; use the container and test command below to run them. The isolated Step 3 PostGIS suite has 37 passing tests. Swagger UI was browser-verified at <http://localhost:3000/docs>; OpenAPI JSON at <http://localhost:3000/docs-json> returned HTTP 200. The read requests above were verified against the running API.

## Step 4 Survey API

Survey routes list observations for an active Site, create observations, partially update them, and hard-delete them. List responses use `page` and `pageSize` (default 1 and 20; maximum page size 100), sorted by survey date then ID descending. Survey IDs are decimal strings. POST and PATCH return the Survey fields plus `siteStatus`, derived from the mean cover of all Surveys on the latest date. DELETE returns `204` without a body.

Coordinates use WGS84 longitude/latitude. A Survey point must be inside or within 50 meters of its Site, measured with PostGIS geography. Dates cannot exceed today in Thailand; cover must be from 0 to 100 and representable at two-decimal precision without rounding. Species codes must exist; duplicate codes become one association. Writes to a Survey and its species links are atomic and serialize with Site geometry edits/deletion.

```sh
curl 'http://localhost:3000/sites/TRG-001/surveys?page=1&pageSize=20'
curl -X POST 'http://localhost:3000/sites/TRG-001/surveys' \
  -H 'Content-Type: application/json' \
  -d '{"lon":99.538168,"lat":7.330521,"surveyed_on":"2025-03-08","cover_percent":62.2,"species":["TH","CR","EA"],"note":null}'
curl -X PATCH 'http://localhost:3000/surveys/123' \
  -H 'Content-Type: application/json' -d '{"cover_percent":50}'
curl -X DELETE 'http://localhost:3000/surveys/123'
```

The POST example uses an existing Survey point and species codes from the committed seed data; it creates a separate Survey without an import reference. The ID `123` is illustrative; use an ID returned by POST. Swagger UI at `/docs` documents the four routes. Survey writes remain unauthenticated until Step 5.

Compose defaults are development-only: database user `seagrass`, password `seagrass_dev_only`, database `seagrass`. Do not use these credentials outside local development. Override them privately in ignored `.env`, based on `.env.example`; never commit secrets.

## Build applications independently

```sh
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)
```

## Backend tests

`cd backend && npm test` runs unit tests; database-backed tests skip unless `IMPORT_TEST_DATABASE_URL` is set. Use a separate disposable PostGIS container, never the development database:

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
IMPORT_TEST_DATABASE_URL=postgresql://seagrass_test:seagrass_test_only@127.0.0.1:55432/seagrass_test npm test
```

The container has no persistent volume. Stop it after tests; `--rm` removes its database. `.env.example` records the test URL separately from Compose development settings.


## Disposable Compose verification

`docker-compose.verify.yml` isolates verification from development: use a unique Compose project and named database volume, loopback-only ports `55433`, `38081`, and `38082`, and a temporary host report directory. The override uses separate database credentials and keeps seed files read-only.

Run from the repository root. Choose unused ports if these defaults are occupied:

```sh
export VERIFY_PROJECT="gis-seagrass-step2-$(date +%s)"
export VERIFY_DB_VOLUME="${VERIFY_PROJECT}-db"
export VERIFY_REPORT_DIR="$(mktemp -d)"
export VERIFY_DB_PORT=55433 VERIFY_API_PORT=38081 VERIFY_WEB_PORT=38082
dc() { docker compose --project-name "$VERIFY_PROJECT" -f docker-compose.yml -f docker-compose.verify.yml "$@"; }

dc config
dc up --build --wait -d
curl --fail http://127.0.0.1:$VERIFY_API_PORT/health
cat "$VERIFY_REPORT_DIR/import_report.csv"
before="$(dc exec -T db psql -U seagrass_verify -d seagrass_verify -Atc 'SELECT count(*) FROM surveys')"
dc down
dc up --build --wait -d
after="$(dc exec -T db psql -U seagrass_verify -d seagrass_verify -Atc 'SELECT count(*) FROM surveys')"
test "$before" = "$after"
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
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/test/schema.sql
```

The check rolls back its temporary data. The database port defaults to `localhost:5432`; published ports bind to loopback by default.