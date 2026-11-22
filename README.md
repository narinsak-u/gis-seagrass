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

The importer serializes runs with a PostgreSQL advisory lock and skips existing identities without overwriting records. It reports inserted, skipped-existing, and rejected counts per source. The host report is `reports/import_report.csv`; its `file,row,reason` rows identify source positions (GeoJSON features start at 1; survey positions include the CSV header). Each run writes evidence for that run's rejected rows.

Verified Compose startup imported the supplied sources. Startup summary: provinces `{inserted:0,skipped_existing:3,rejected:0}`, species `{0,6,0}`, sites `{0,27,3}`, surveys `{274,0,26}`. Resulting database totals were 3 provinces, 6 species, 27 Sites, 274 surveys, and 543 `survey_species` links. These are observed results, not application constants. The report identified Site feature positions 9 and 19 as `INVALID_GEOMETRY`, and position 30 as `DUPLICATE_CODE`; it also records all 26 survey rejections with positions and reasons.

Re-running import skips existing records and revalidates source errors. Restart the full stack without deleting its named volume:

```sh
docker compose down
docker compose up --build --wait -d
```

Startup repeats migrations and import before API readiness. `docker compose down` preserves the database volume; never add `-v` unless you intend to erase it. The source files are mounted read-only. These results cover this local Compose dataset, not production scale or concurrent CRUD editing.

Compose defaults are development-only: database user `seagrass`, password `seagrass_dev_only`, database `seagrass`. Do not use these credentials outside local development. Override them privately in ignored `.env`, based on `.env.example`; never commit secrets.

## Build applications independently

```sh
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)
```

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