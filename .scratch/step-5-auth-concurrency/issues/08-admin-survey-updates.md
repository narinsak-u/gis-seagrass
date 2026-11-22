# 08: Admin Survey updates

**What to build:** An admin can correct Survey fields or species associations while recording who made the update; other callers cannot modify observations or discover whether the Survey exists.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `PATCH /surveys/:id` requires an active admin token. Missing/invalid tokens return `401 UNAUTHORIZED`, viewer/editor tokens return `403 FORBIDDEN`, and authorization precedes ID validation and Survey lookup for parseable bodies.
- [ ] Successful partial updates retain Step 4 coordinate, date, cover, species replacement, location, and derived `siteStatus` behavior. Persist authenticated `updated_by` and server `updated_at` on every successful PATCH, including species-only PATCH; keep `created_by` unchanged.
- [ ] Audit fields supplied by the client cannot impersonate an actor. Preserve the existing write response shape, immutable Site association, atomic species links, and serialization against Site geometry edits.
- [ ] OpenAPI and README document the implemented admin-only update route. Real HTTP/PostGIS tests cover role precedence, species-only timestamps/actors, omitted versus null fields, forged audit input, and existing spatial validation; adapt older API tests to admin credentials.
