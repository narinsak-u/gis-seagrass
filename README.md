# Seagrass Monitoring

Step 1 provides a development Compose stack, versioned PostgreSQL/PostGIS schema, and live database health endpoint. It does not provide data import, site or survey CRUD, authentication, or a map.

## Start the development stack

Docker Compose builds and starts the `db`, `api`, and `web` services:

```sh
docker compose up --build
```

First startup may take several minutes while Docker downloads images and builds the applications. Compose waits for database readiness; the API applies migrations before listening. Open the web app at <http://localhost:3001>. A healthy `GET /health` at <http://localhost:3000/health> returns HTTP 200 with exactly `db` and `postgis` keys, such as:

```json
{"db":"ok","postgis":"3.4.0"}
```

`postgis` is read from the database at request time; the version shown above is an example. The published database port defaults to `localhost:5432`.

Compose defaults are development-only: database user `seagrass`, password `seagrass_dev_only`, database `seagrass`. Do not use these credentials outside local development. To override them, copy `.env.example` to the ignored `.env` file and edit it privately. The example binds published ports to `127.0.0.1`; keep that loopback bind unless you deliberately need network access. Never commit `.env` or production secrets.

## Build applications independently

Backend and frontend have separate npm manifests and lockfiles:

```sh
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)
```

These commands install and build each application independently from the repository root.

## Database checks

The API applies ordered Drizzle SQL migrations at startup: PostGIS extension first, then schema. To safely rerun the migration runner while Compose is up:

```sh
docker compose exec api npm run migrate
```

Check tables, constraints, indexes, and database-enforced behavior with the rollback-only schema check:

```sh
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/test/schema.sql
```

This check rolls back its temporary data. No application importer or CRUD endpoints exist yet.

## Manual persistence and outage checks

1. Insert a temporary, uniquely identified row into the database.
2. Restart without deleting the named volume: `docker compose restart`.
3. Query for that row to confirm it remains, then delete the temporary row.
4. Stop the database with `docker compose stop db`. The health endpoint should stop returning HTTP 200 while its database query fails.
5. Restore it with `docker compose start db`; wait for readiness and check health again.

These are manual checks; this document does not claim they have been run.

## Stop and clean up

```sh
docker compose down
```

This stops the stack and removes its containers and network while preserving the database volume.

Do not use `docker compose down -v` for routine cleanup: it deletes the named database volume and all stored data. Use it only when you intentionally want to erase the development database.