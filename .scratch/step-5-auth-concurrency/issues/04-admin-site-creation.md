# 04: Admin Site creation

**What to build:** An admin can register a Site with its creator recorded; anonymous, viewer, and editor callers cannot register Sites or learn whether a submitted Site would pass validation.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `POST /sites` requires an active admin token. Missing/invalid tokens return `401 UNAUTHORIZED`; viewer/editor tokens return `403 FORBIDDEN` before business validation or resource lookup, using the shared error envelope.
- [ ] A successful create preserves existing Site geometry, Province, code-reservation, HTTP status, and response contracts. Its stored `created_by` and `updated_by` identify the authenticated admin; `updated_at` comes from server time. Client-supplied actor/timestamp fields cannot override them.
- [ ] OpenAPI and root README document the new access rule without claiming other Site writes are protected until their tickets are complete.
- [ ] Real HTTP/PostGIS tests cover all roles, live role changes, malformed parseable bodies versus authorization order, saved actor fields, forged actor input, and existing Site creation errors. Update prior API tests to use valid admin credentials while keeping the full suite green.
