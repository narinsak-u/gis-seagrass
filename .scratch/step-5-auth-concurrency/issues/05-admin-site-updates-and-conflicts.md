# 05: Admin Site updates and version conflicts

**What to build:** An admin can change a Site name or boundary while preserving Survey distance and version guarantees. A stale edit exposes the current Site Feature in a shared-error response so the admin can reconcile it.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `PATCH /sites/:code` requires an active admin token for name-only, geometry-only, and combined changes. Missing/invalid tokens return `401 UNAUTHORIZED`; viewer/editor tokens return `403 FORBIDDEN`, including editor geometry changes and nonexistent Sites, before business validation or lookup.
- [ ] Successful PATCH requires the client's Site version, compares and increments it atomically, and retains Step 3 geometry/Province/Survey-distance validation and Site PATCH success shape. Persist authenticated `updated_by` and server `updated_at` without changing `created_by`; client-supplied audit fields cannot spoof actors.
- [ ] A stale authorized PATCH returns `409 VERSION_CONFLICT` in the shared envelope with the current Site GeoJSON Feature, matching the Site PATCH success representation, at `error.details.current`. Unauthorized/forbidden callers cannot obtain this representation.
- [ ] Two real concurrent authorized PATCH requests using one version yield exactly one success and one conflict. Real HTTP/PostGIS tests assert final Site data, audit fields, version increment, and intact Survey spatial invariants.
- [ ] OpenAPI and root README document the actual protected PATCH behavior, version conflict shape, and editor denial. Existing Site API tests continue passing with authenticated write requests.
