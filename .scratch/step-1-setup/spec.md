Status: ready-for-agent

## Problem Statement

A fresh checkout cannot yet start the Seagrass Monitoring System. The backend and frontend are empty, and there is no running PostGIS database, schema migration, or live health check. Developers need a reproducible, safe local setup before importing data or building the application.

## Solution

A developer starts three Docker Compose services with one command: persistent PostGIS, a NestJS API, and a Next.js web app. The API applies versioned migrations before accepting requests. Its health endpoint verifies the connected database and returns the installed PostGIS version. Development-only credentials allow a fresh checkout to start without creating a private environment file; untracked overrides support private credentials.

## User Stories

1. As a developer, I want a fresh checkout to start with Docker Compose, so that I can work without manual database provisioning.
2. As a developer, I want exactly database, API, and web services, so that startup has no unrelated infrastructure.
3. As a developer, I want separate backend and frontend npm applications, so that either can be installed and built independently.
4. As a developer, I want a persistent database volume, so that a service restart does not erase records.
5. As a developer, I want PostgreSQL with PostGIS, so that later features can store and query geographic data.
6. As a developer, I want database readiness checks, so that the API does not attempt migrations against an unavailable database.
7. As a developer, I want the API to migrate before listening, so that requests never reach an uninitialized schema.
8. As a developer, I want startup to fail when a migration fails, so that schema errors are visible rather than hidden.
9. As a developer, I want versioned, repeatable migrations, so that restarts do not reapply DDL or silently change the schema.
10. As a developer, I want spatial columns constrained to their geometry type and SRID, so that invalid shapes cannot enter the database.
11. As a developer, I want users with unique emails and allowed roles, so that later authentication can depend on sound records.
12. As a developer, I want provinces and species represented in the schema, so that later imports have reference data targets.
13. As a developer, I want sites linked to provinces and optional creator/updater users, so that provenance and attribution can be added without blocking imports.
14. As a developer, I want only active site codes to be unique, so that soft-deleted site codes can be reused.
15. As a developer, I want positive site versions, so that later concurrency checks have valid starting values.
16. As a developer, I want surveys linked to sites without deleting survey history when a site is removed, so that referenced data remains protected.
17. As a developer, I want survey references unique when present, so that known references cannot be duplicated.
18. As a developer, I want survey cover percentage constrained to 0–100, so that invalid coverage cannot be stored.
19. As a developer, I want survey species linked to known species, so that later survey records use consistent names.
20. As a developer, I want spatial and site/date indexes, so that later geographic and historical queries have suitable access paths.
21. As a developer, I want an HTTP health check to query the actual database and PostGIS installation, so that success means the spatial database works.
22. As a developer, I want the health response to report the installed 3.x PostGIS version, so that it cannot conceal a missing or incompatible extension.
23. As a developer, I want health checks to fail when the database fails, so that unhealthy API instances are not reported healthy.
24. As a developer, I want web readiness verified over HTTP, so that a running but unresponsive web process is not marked healthy.
25. As a developer, I want a simple web start page, so that I can verify the web service is reachable without prematurely building the map UI.
26. As a developer, I want documented environment overrides and configurable local ports, so that I can adapt the setup without editing tracked configuration.
27. As a developer, I want development-only default credentials and loopback-bound host ports, so that first startup is convenient without exposing local services to the network by default.
28. As a developer, I want real passwords and private environment files excluded from Git, so that local secrets are not published.
29. As a developer, I want startup, test, and limitation instructions, so that I can reproduce and assess the completed setup.
30. As a developer, I want fresh startup to reach healthy services within five minutes after images are available, so that setup failures are apparent.

## Implementation Decisions

- Use one Git repository with two independent TypeScript/npm applications. Each owns its manifest, lockfile, build configuration, Docker build context, and dependency lifecycle; do not add a root workspace or shared package.
- Coordinate exactly three core services: database, API, and web. Persist database data in a named volume. Use a compatible pinned PostGIS image and multi-stage application images.
- Provide development-only database credentials by default and allow private environment overrides. Bind published development ports to loopback by default. Never track a private environment file or production credential.
- Make the API wait for a healthy database, run versioned Drizzle/SQL migrations, and only then start the NestJS listener. Fail startup on migration errors. Do not use runtime schema synchronization.
- Enable PostGIS in a migration. Create users, provinces, species, sites, surveys, and survey_species with the specified UUID, identity, composite, foreign-key, timestamp, geometry, numeric, and nullable attribution fields.
- Enforce allowed user roles, positive site versions, 0–100 survey coverage, geometry type/SRID 4326, active-only site-code uniqueness, and present-only survey-reference uniqueness. Do not cascade removal of a site into surveys.
- Add GiST indexes for province/site/survey geometry and a descending site/date/id survey index.
- Return HTTP 200 with exactly `db` and `postgis` keys from the health endpoint. Query the connected database for the actual PostGIS version; return an unhealthy response if that query fails. API health and web readiness must be genuine HTTP checks.
- The browser-facing API location is distinct from the container-internal database host. The API connects to the Compose database service, never to container-local `localhost`.
- Keep the web landing page minimal. Do not start an importer or add empty future-feature modules.
- Document only implemented commands, behavior, trade-offs, and limits. After verification, commit Step 1 changes with the mandated `step-1:` prefix; do not begin Step 2 automatically.

## Testing Decisions

- Primary seam: exercise a running Compose stack through its public HTTP endpoints and PostgreSQL SQL/catalog queries. This is the highest practical seam for startup order, schema, and persistence without introducing a test-only application interface.
- Check independent npm clean installs and builds, plus Compose configuration with documented development defaults and environment overrides.
- Start with a fresh named volume and built images; require all three services to become healthy within five minutes after image downloads.
- Request the API health endpoint; assert HTTP 200, exactly the required keys, and a real installed PostGIS 3.x version. Check the web endpoint over HTTP.
- Inspect the database catalogs for all six tables, required columns, foreign keys, checks, unique indexes, spatial GiST indexes, and the site/date index. Validate behavior where possible rather than checking generated SQL text.
- Run the migration runner again and verify it succeeds without duplicate DDL.
- Insert a uniquely identified temporary row, restart services without deleting volumes, verify that row persists, and remove only that temporary row afterward.
- Stop the database and verify the API no longer reports healthy; restore services for cleanup if needed.
- Check that private environment files and real passwords are not tracked and that original seed files were not changed.
- A good test observes external behavior or persisted state, fails on a plausible user-visible defect, and does not depend on incidental source wording. There is no existing test suite or prior comparable integration test in this empty application; use direct Compose, HTTP, and SQL checks rather than inventing extra seams.

## Out of Scope

- Data import, spatial validation of imported records, and import reports.
- Site/survey CRUD, browser-facing API features, Swagger, authentication, RBAC, and optimistic locking.
- Map interactions, dashboards, exports, production deployment, and production credential management.
- A fourth permanent service, a root npm workspace, and placeholder feature modules.

## Further Notes

- The existing Step 1 plan is the source of schema detail and acceptance criteria; this issue records the agreed development-credential and testing-seam decisions.
- No implementation exists yet. Do not mark the feature complete until the startup, database, health, persistence, and failure checks actually pass.
