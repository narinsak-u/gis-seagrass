# 09: Admin Survey hard deletion

**What to build:** An admin can permanently remove a Survey and its species associations, while viewers and editors retain read-only access and cannot probe whether an observation exists through deletion.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `DELETE /surveys/:id` requires an active admin token. Missing/invalid tokens return `401 UNAUTHORIZED`, viewer/editor tokens return `403 FORBIDDEN`, and authorization precedes ID validation and Survey lookup.
- [ ] A successful delete remains `204` with no body, atomically removes the Survey and species associations, and leaves no orphan links. Step 4's derived Site status reflects deletion on its next calculation without a cached write.
- [ ] Hard deletion leaves no durable actor history, as agreed; no audit-event store or tombstone is added. Unknown valid IDs and malformed IDs keep their Step 4 error behavior for authorized callers.
- [ ] OpenAPI and README document the implemented admin-only delete route. Real HTTP/PostGIS tests cover all roles, missing resources, linked species cleanup, and unchanged hard-delete behavior; adapt existing API tests to admin credentials.
