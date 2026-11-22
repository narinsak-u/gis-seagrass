# 03: Start and document the complete three-service stack

**What to build:** A developer with a fresh checkout starts the complete Seagrass Monitoring System using one Compose command, sees a minimal web start page, and finds reliable readiness and documented setup behavior. The full stack retains its schema and data, and failed database health is visible.

**Blocked by:** 02: Persist and verify the Step 1 schema.

**Status:** resolved

- [x] Compose contains exactly database, API, and web services. Fresh startup runs migrations before API traffic and no importer.
- [x] The Next.js frontend has an independent TypeScript/npm manifest and lockfile; a clean install and build succeed without a root workspace.
- [x] The web service displays the system name and has a real HTTP readiness check, not a process-only check. All three services become healthy within five minutes after initial image downloads.
- [x] Container health and dependency ordering prevent premature healthy status; the API connects to the Compose database host and keeps any browser-facing API location distinct from internal service URLs.
- [x] Both application images use multi-stage builds with scoped build contexts; local ports are configurable and loopback-bound by default.
- [x] Compose configuration resolves with documented development defaults and private environment overrides. Real passwords and private environment files are not tracked, and original source data remain unchanged.
- [x] Verify from a fresh volume: all three services healthy, HTTP web readiness, live PostGIS health with the required JSON keys, all six tables and required constraints/indexes.
- [x] Verify migrations rerun safely, a temporary row persists across service restart, and the API ceases to report healthy when the database stops; restore services and clean up the test row.
- [x] Update startup, test, implemented-scope, architectural-decision, and limitation documentation to reflect only verified Step 1 behavior.
- [x] Review changed files and secrets, then commit verified Step 1 work with the `step-1:` prefix; do not begin Step 2.
