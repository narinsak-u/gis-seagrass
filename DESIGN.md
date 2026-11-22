# Design decisions

## Geometry and validation

PostGIS stores province and site boundaries as `geometry(MultiPolygon, 4326)` and survey locations as `geometry(Point, 4326)`. These column types enforce geometry type and SRID. GiST indexes support future spatial queries; Step 1 implements no spatial API.

The database enforces required fields, foreign keys, allowed user roles, positive site versions, survey cover between 0 and 100, and uniqueness rules for active site codes and present survey references. Foreign keys restrict deletion of referenced records. Application validation is limited to the seed importer; it does not repair geometry or require boundary containment.

## Soft-deleted Site codes

Step 2 import treats every existing Site code as reserved, including codes on Soft-deleted sites. It skips those source records without overwriting or restoring historical Sites. Restoring a Site requires an explicit action outside Step 2; surveys cannot import against Soft-deleted Sites.

## Migration ordering

Drizzle's migration journal applies `0000_enable_postgis.sql` before `0001_create_schema.sql`, so PostGIS types and functions exist before schema creation. The API runs migrations before opening its HTTP listener. The migration runner records applied migrations and can be rerun without blindly replaying DDL.

## Concurrency and scaling limits

The import holds PostgreSQL advisory lock `192837465` for the full import pass so concurrent importer processes serialize. Unique database constraints remain the final protection for persisted identities. The lock applies only to imports; it does not define concurrent Site or Survey CRUD edit behavior.

No worker model, replicas, load balancing, or production scaling configuration exists. Design those policies when their use cases are in scope; do not infer them from the schema or import lock.

## Development security limits

Compose defaults use development-only credentials and publish database and API ports on loopback by default. `.env` is for private local overrides, not committed secrets. These safeguards do not make the stack production-ready: defaults are public in the repository, there is no authentication or authorization, and the stack has no production secret management or hardening.
