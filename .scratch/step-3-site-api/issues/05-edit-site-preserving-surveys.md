# 05: Edit Sites without overwriting versions or stranding Surveys

**What to build:** Editors can update a Site name or geometry with a version precondition. Geometry edits preserve each linked Survey inside or within 50 meters of the Site, even when Survey import runs concurrently.

**Blocked by:** 04: Create valid Sites and reserve historical codes.

**Status:** ready-for-agent

- [ ] `PATCH /sites/:code` requires a positive integer version and at least one of name or GeoJSON geometry; rejects code, derived fields, unknown fields, and malformed properties with `400 VALIDATION_ERROR`.
- [ ] Name-only PATCH leaves spatial derivations unchanged; geometry PATCH revalidates Polygon/MultiPolygon, Province coverage, province assignment, and numeric rai by the creation rules, returning `400 INVALID_GEOMETRY` or `422 OUTSIDE_COVERAGE` as appropriate.
- [ ] A successful PATCH atomically checks and increments version and returns `200` Site Feature; stale versions return `409 VERSION_CONFLICT`, and missing or Soft-deleted sites return `404 SITE_NOT_FOUND`.
- [ ] Geometry edits preserve linked Surveys inside or at most 50 meters from the Site geometry on geography; otherwise return `409 SURVEYS_OUTSIDE` with no persisted edit.
- [ ] Site edits and the existing Survey importer serialize per Site across the Survey check-and-insert transaction; a concurrent import cannot strand a Survey after either transaction commits.
- [ ] Real HTTP/PostGIS and importer integration tests cover immutable fields, name-only behavior, spatial recomputation, stale versions, Survey boundary/distance cases, and both outcomes of concurrent edits/imports.
