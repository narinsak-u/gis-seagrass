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

Site map, list, detail, and derived status reads remain public. Survey listing requires an active viewer, editor, or admin; all Site and Survey writes require an active admin. Access tokens carry a user ID and expire after 900 seconds. Protected requests resolve the user's current active flag and role from the database, so disabling or changing a user takes effect on the next request. Role checks run before resource lookup; malformed JSON is rejected by the HTTP parser first.

The server records the authenticated actor on Site and Survey creation and updates, including species-only Survey changes and Site soft deletion. Clients cannot supply actor or timestamp fields. Survey hard deletion removes the row and species links, so no actor history survives it.

Site PATCH locks the Site row and compares the client's version within the update transaction. Only one concurrent update with a given version can commit. A stale authorized request receives the current Site PATCH GeoJSON Feature at `error.details.current`; this does not expose Site data to callers lacking access.

Development account seeding requires an explicit flag and inserts only missing accounts. API startup requires a deployment-specific `JWT_SECRET`; the example signing secret and credentials are for local development only.

## Backend architecture refactor

Keep one pool-backed Drizzle provider per process entrypoint. The API composition root shares its provider across migrations, startup import, and Nest, then closes it once. The standalone importer owns and closes its provider without starting Nest. Its session advisory lock stays pinned to one pool client.

Sites, Surveys, and Auth each own `http`, `application`, `domain`, and `infrastructure` layers. Platform owns database schema and migrations, health checks, and global HTTP error mapping. Shared application errors, generic input checks, and WGS84 geometry rules live outside feature modules. External feature use goes through public application contracts and use cases; adapters stay private to composition roots.

Nest modules are composition roots, not one module per layer. `SitesModule` and `SurveysModule` register their HTTP and read adapters. `SiteSurveyModule` wires cross-feature use cases to feature-owned Drizzle adapters. Import composes those adapters in its own CLI infrastructure. Do not add separate Nest infrastructure modules for provider registration.

Workflows spanning Sites and Surveys go through the application-level `SiteSurveyCoordinator`. It owns transaction sequencing and passes one opaque `SiteWriteTransaction` context through Site- and Survey-owned persistence ports. The Drizzle transaction runner and adapters alone unwrap that context. Survey writes use `SurveyWriter`, including imports, so site locking, distance checks, species association atomicity, and per-Survey rollback remain shared with API behavior. Imports keep null actor history.

Import owns parser, application, and infrastructure responsibilities while remaining a standalone CLI. It composes the Site and Survey application operations without starting the HTTP application. Auth login and active-user/current-role lookups use application ports with Drizzle-owned persistence. HTTP controllers contain no database queries.

Use Drizzle for ordinary reads and writes. Keep PostGIS operations, row locks, advisory locks, and query-builder gaps as explicit SQL in infrastructure. Health retains its pool-level PostGIS check. This keeps spatial behavior visible without adding generic repositories or hiding transaction boundaries.

HTTP request DTOs use one global transforming, whitelisting `ValidationPipe`; query conversion is explicit and request bodies are not coerced. `ApiErrorFilter` maps framework-independent application errors to HTTP statuses and preserves the shared error envelope.

## Migration ordering

Drizzle's migration journal applies `0000_enable_postgis.sql` before `0001_create_schema.sql`, so PostGIS types and functions exist before schema creation. Step 3 adds `0002_reserve_site_codes.sql` to enforce permanent Site-code uniqueness without rewriting applied migrations. Step 5 adds `0003_add_active_users.sql`, defaulting existing users to active. The API runs migrations before opening its HTTP listener. The migration runner records applied migrations and can be rerun without blindly replaying DDL.

## Concurrency and scaling limits

The importer-wide PostgreSQL advisory lock `192837465` serializes importer instances. Importer and Site API writes also lock the corresponding Site row with `FOR UPDATE`; Step 4 Survey writes must use the same row lock to preserve per-Site spatial and active-Site invariants.

No worker model, replicas, load balancing, or production scaling configuration exists. Design those policies when their use cases are in scope; do not infer them from the schema or import lock.

## Development security limits

Compose defaults use development-only credentials and publish database and API ports on loopback by default. `.env` is for private local overrides, not committed secrets. Authentication does not make this stack production-ready: development accounts and example secrets are public in the repository, and there is no production secret management or hardening. Do not enable development seeding or use the example signing secret in deployments.
