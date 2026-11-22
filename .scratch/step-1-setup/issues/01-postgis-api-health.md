# 01: Start PostGIS and verify live API health

**What to build:** A developer can start a persistent spatial database and the API with development-only credentials, then request an HTTP health check that confirms the actual installed PostGIS version. The API applies its initial versioned migration before accepting traffic and reports unhealthy when its database query fails.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] PostgreSQL/PostGIS and NestJS API start through Docker Compose; the database has a named persistent volume and a real readiness check.
- [x] The backend has an independent TypeScript/npm manifest and lockfile; a clean install and build succeed without a root workspace.
- [x] Development-only credentials work on a fresh checkout, private environment overrides are supported, and published development ports bind to loopback by default.
- [x] The API waits for a healthy database, enables PostGIS through a versioned Drizzle/SQL migration, and fails startup if migration fails; no runtime schema push is used.
- [x] The migration runner can run twice without reapplying DDL or failing.
- [x] `GET /health` returns HTTP 200 with exactly `db: "ok"` and the version read from the running PostGIS 3.x installation; it never reports a hard-coded version.
- [x] When the database is stopped, the API no longer reports healthy. Restore the database after the check.
- [x] No importer, domain CRUD, auth, or placeholder future-feature modules are added.
