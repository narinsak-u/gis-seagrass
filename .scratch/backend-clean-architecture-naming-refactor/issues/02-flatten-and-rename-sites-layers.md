# 02: Flatten and rename Sites layers

**What to build:** Visitors and administrators retain identical Site API behavior—listing, detail retrieval, GeoJSON bounding-box queries, Site creation, geometry/name editing, Soft-deleted site code reservation, optimistic version conflicts, derived Site status, and Swagger documentation—while Sites uses flat `domain`, `application`, `infrastructure`, and `presentation` layers with clear responsibility-based naming.

**Blocked by:** 01: Prepare architecture check for flat-layer transition

**Status:** ready-for-agent

- [ ] Sites exposes four flat physical layers (`domain`, `application`, `infrastructure`, `presentation`) with no remaining nested `http`, `dto`, `contracts`, `use-cases`, or `repositories` folders.
- [ ] Sites preserves role-honest `SiteQueries` and separate read and write repository ports and Drizzle adapters, uses the repository dot-suffix convention for persistence ports/adapters, uses the port dot-suffix convention for the Site–Survey read port, marks Site status derivation explicitly as domain rules, and uses consistent feature-plural presentation naming for controllers, DTOs, and OpenAPI definitions.
- [ ] Sites' module wiring, public barrel exports, `SiteSurveyModule` composition wiring, and Import CLI composition wiring compile cleanly without exposing private infrastructure across boundaries.
- [ ] Existing Site CRUD, GeoJSON bbox, Swagger/OpenAPI, Site status, Soft-deleted site, spatial, and version-conflict tests pass against disposable PostGIS alongside the backend build and architecture check.
