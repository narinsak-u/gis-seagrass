# Design decisions

## Geometry and validation

PostGIS stores province and site boundaries as `geometry(MultiPolygon, 4326)` and survey locations as `geometry(Point, 4326)`. These column types enforce geometry type and SRID. GiST indexes support future spatial queries; Step 1 implements no spatial API.

The database enforces required fields, foreign keys, allowed user roles, positive site versions, survey cover between 0 and 100, permanent Site-code uniqueness, and uniqueness for present survey references. Foreign keys restrict deletion of referenced records. Application validation is limited to the seed importer; it does not repair geometry or require boundary containment.

## Soft-deleted Site codes

Step 2 import treats every existing Site code as reserved, including codes on Soft-deleted sites. It skips those source records without overwriting or restoring historical Sites. Restoring a Site requires an explicit action outside Step 2; surveys cannot import against Soft-deleted Sites.

## Step 3 Site API policy

Site codes remain permanently reserved after soft deletion; the database enforces uniqueness across historical and active rows. API reads include active Sites only, including when the optional status filter is present. A Site with any linked Surveys cannot be soft-deleted.

Sites may overlap; no overlap ban is enforced. Create and geometry updates require positive-area Province coverage. Geometry updates recompute Province and area, and preserve every linked Survey within 50 meters using `ST_DWithin` on geography. Survey insertion and Site edit/delete serialize per Site, including importer writes. PATCH checks and increments version atomically.

Step 3 initially shipped unauthenticated writes. Step 5 requires an active admin token for every Site write.

## Step 4 Survey API policy

Site status is derived from current Survey rows, not stored as a cache. POST and PATCH return the flat Survey representation with top-level `siteStatus`. DELETE remains `204` with no response body; the derived status reflects deletion on its next calculation.

## Step 5 access and audit policy

Site map, list, detail, and derived status reads remain public. Survey listing requires an active viewer, editor, or admin; all Site and Survey writes require an active admin. Access tokens carry a user ID and expire after 900 seconds. Protected requests resolve the user's current active flag and role from the database, so disabling or changing a user takes effect on the next request. Role checks run before resource lookup; login body-parser failures are handled as described under Backend architecture, while other malformed JSON is rejected by the HTTP parser first.

The server records the authenticated actor on Site and Survey creation and updates, including species-only Survey changes and Site soft deletion. Clients cannot supply actor or timestamp fields. Survey hard deletion removes the row and species links, so no actor history survives it.

Site PATCH locks the Site row and compares the client's version within the update transaction. Only one concurrent update with a given version can commit. A stale authorized request receives the current Site PATCH GeoJSON Feature at `error.details.current`; this does not expose Site data to callers lacking access.

Development account seeding requires an explicit flag and inserts only missing accounts. API startup requires a deployment-specific `JWT_SECRET`; the example signing secret and credentials are for local development only.

## Backend architecture

Keep one pool-backed Drizzle provider per process entrypoint. The API composition root shares its provider across migrations, startup import, and Nest, then closes it once. The standalone importer owns and closes its provider without starting Nest. Its session advisory lock stays pinned to one pool client.

Per [ADR-0002](docs/adr/0002-flat-clean-architecture-naming.md), HTTP features (`sites`, `surveys`, and `auth`) each own four flat physical Clean Architecture layers—`domain`, `application`, `infrastructure`, and `presentation`—without nested `http`, `dto`, `contracts`, `use-cases`, `repositories`, `transactions`, or `security` subfolders. `site-survey-workflows` uses flat `application` and `infrastructure` layers, and `import` keeps `parser`, flat `application`, and `infrastructure`. File names express responsibility directly: role-honest application entrypoints (`AuthService`, `SiteQueries`, `SurveyCommands`, `SiteSurveyCoordinator`, `import-sites.ts`, `import-surveys.ts`), repository ports as `*.repository.ts` in `application/` with concrete `drizzle-*.repository.ts` adapters in `infrastructure/`, non-repository application ports as `*.port.ts` (`site-survey-read.port.ts`, `transaction-runner.port.ts`), presentation files as `*.controller.ts`, `*.guard.ts`, `*.dto.ts`, `*.validation.ts`, and `*.openapi.ts`, singular domain files in `domain/`, and `auth-token.ts` directly in `auth/application/`. Platform owns database schema and migrations, health checks, and global HTTP error mapping. Shared application errors, generic input checks, and WGS84 geometry rules live outside feature modules. External feature use goes through public module exports; adapters stay private to composition roots. These layer boundaries are documented guidance; no static architecture spec enforces them.

Nest modules are composition roots, not one module per layer. `SitesModule` and `SurveysModule` register their presentation controllers and read adapters. The single root `SiteSurveyModule` in `site-survey-workflows` wires cross-feature workflows to feature-owned Drizzle repositories. Application-port tokens register their Drizzle implementations with `useClass` where consumers use only the port; no concrete-token aliases are added. Import composes those repositories in its CLI infrastructure. Do not add duplicate feature submodules or infrastructure Nest modules for provider registration.

Workflows spanning Sites and Surveys go through the application-level `SiteSurveyCoordinator`. It owns transaction sequencing and passes one opaque `SiteWriteTransaction` context through Site- and Survey-owned repository ports (`*.repository.ts`) and `transaction-runner.port.ts`. The Drizzle transaction runner and `site-survey-workflows/infrastructure/drizzle-transaction.ts` adapter alone unwrap that context. `SurveyCommands` handles Survey writes, including imports; its shared update/delete lock helper locks the active Site before the Survey row, preserving Site locking and per-Survey rollback. Imports keep null actor history.

Import owns `parser`, flat `application` (`import-sites.ts`, `import-surveys.ts`), and `infrastructure` responsibilities while remaining a standalone CLI. It composes Site and Survey operations without starting the HTTP application. Auth login and active-user/current-role lookups use `auth.repository.ts` with Drizzle-owned persistence (`drizzle-auth.repository.ts`). Presentation controllers contain no database queries.

Per [ADR-0003](docs/adr/0003-drizzle-first-query-policy.md), repositories default to Drizzle's typed query builder (`.select()`, `.insert()`, `.update()`, `.delete()`, joins, `.for('update')` row locks, `.onConflictDoNothing()`, and `$with` CTEs) with targeted parameterized `sql<T>` expressions for PostgreSQL/PostGIS functions, explicit casts, and literal-substring `strpos` predicates. `DrizzleSurveyStatusRepository` and `DrizzleSurveyWriteRepository` share the internal `surveys/infrastructure/latest-cover-percentages.ts` CTE helper across both pool and transaction executors. Complete raw SQL (`execute`/`query`) is retained only where materially clearer or required at the driver boundary: `deriveSiteSpatial()` in `drizzle-site-write.repository.ts` (4-stage `WITH ... MATERIALIZED` PostGIS CTE), plus the untouched import reference-data geometry validation (`import/infrastructure/reference-data.ts`), pinned-client session advisory lock (`import/infrastructure/advisory-lock.ts`), and pool-level PostGIS health check (`platform/health/health.controller.ts`). This keeps spatial behavior and transaction boundaries explicit without adding generic repositories or GIS wrappers.

HTTP request DTOs use one global transforming, whitelisting `ValidationPipe`; query conversion is explicit. Survey DTOs own ordinary field validation; `parseSurveyInput` keeps coordinate-pair, strict calendar-date, and raw JSON `cover_percent` precision rules. Request bodies are not coerced, except parser failures on `POST /auth/login` are replaced with an empty body so throttling runs before normal validation rejects it.

Backend specs sit beside their source owners and use Vitest `expect` assertions. TypeScript emits Nest decorator metadata for those specs; `npm test` builds compiled subprocess targets first. Database-backed specs run serially only with `IMPORT_TEST_DATABASE_URL` pointing at disposable PostGIS.

## Frontend architecture

Frontend stays feature-first: UI lives in `components/`, feature hooks in `hooks/`, and feature contracts remain feature-owned. One Axios client owns same-origin `/api` transport, its 10-second timeout, cancellation, and normalized errors; Site, Province, Survey, login, and identity response boundaries parse with Zod. TanStack Query owns remote data, request lifecycle, and caching; Zustand owns shared Site-workspace filters, pagination, and selection plus memory-only auth session state. Protected requests receive their token explicitly. Survey query keys include a session epoch so account changes cannot reuse prior-session history; logout and `401` clear the protected Survey cache. Site and Province geometry requests remain bounded to the current viewport; table filtering and pagination do not provide nationwide search, and Survey map points cover only loaded history pages.

Tests live under each feature's `tests/` directory and use Vitest assertions; shared library tests live in `src/lib/tests/`.

## Migration ordering

Drizzle's migration journal applies `0000_enable_postgis.sql` before `0001_create_schema.sql`, so PostGIS types and functions exist before schema creation. Step 3 adds `0002_reserve_site_codes.sql` to enforce permanent Site-code uniqueness without rewriting applied migrations. Step 5 adds `0003_add_active_users.sql`, defaulting existing users to active. The API runs migrations before opening its HTTP listener. The migration runner records applied migrations and can be rerun without blindly replaying DDL.

## Concurrency and scaling limits

The importer-wide PostgreSQL advisory lock `192837465` serializes importer instances. Importer and Site API writes also lock the corresponding Site row with `FOR UPDATE`; Step 4 Survey writes must use the same row lock to preserve per-Site spatial and active-Site invariants.

No worker model, replicas, load balancing, or production scaling configuration exists. Design those policies when their use cases are in scope; do not infer them from the schema or import lock.

## Development security limits

Compose publishes the database for local tooling and Caddy as the only browser-facing entrypoint; API and Web have no host ports. Caddy overwrites `X-Forwarded-For`, and Nest trusts exactly one proxy hop.

Only `POST /auth/login` is throttled at 20 attempts per 60 seconds per client IP. Nest's in-memory counters reset on restart and do not span API replicas; shared storage is out of scope.

Compose credentials and development accounts are not production-safe. `.env` is for private local overrides, not committed secrets. This stack has no production secret management or hardening; do not enable development seeding or use the example signing secret in deployments.
