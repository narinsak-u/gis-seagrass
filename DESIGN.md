# Design decisions

## Geometry and validation

PostGIS stores province and site boundaries as `geometry(MultiPolygon, 4326)` and survey locations as `geometry(Point, 4326)`. These column types enforce geometry type and SRID. GiST indexes support future spatial queries; Step 1 implements no spatial API.

The database enforces required fields, foreign keys, allowed user roles, positive site versions, survey cover between 0 and 100, and uniqueness rules for active site codes and present survey references. Foreign keys restrict deletion of referenced records. No application-level validation, geometry repair, boundary containment, or import validation exists yet.

## Migration ordering

Drizzle's migration journal applies `0000_enable_postgis.sql` before `0001_create_schema.sql`, so PostGIS types and functions exist before schema creation. The API runs migrations before opening its HTTP listener. The migration runner records applied migrations and can be rerun without blindly replaying DDL.

## Concurrency and scaling: not implemented

Sites include a `version` column, but no API or optimistic concurrency behavior exists. No concurrent edit policy, worker model, replicas, load balancing, or production scaling configuration exists. Design these when their use cases are in scope; do not infer them from the schema.

## Development security limits

Compose defaults use development-only credentials and publish database and API ports on loopback by default. `.env` is for private local overrides, not committed secrets. These safeguards do not make the stack production-ready: defaults are public in the repository, there is no authentication or authorization, and the stack has no production secret management or hardening.
