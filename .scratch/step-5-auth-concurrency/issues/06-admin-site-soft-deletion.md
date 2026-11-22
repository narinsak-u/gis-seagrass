# 06: Admin Site soft deletion

**What to build:** An admin can retire a Survey-free Site, preserving the retained Site's last actor while other roles cannot delete Sites or probe whether a Site exists.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `DELETE /sites/:code` requires an active admin token. Missing/invalid tokens return `401 UNAUTHORIZED`, viewer/editor tokens return `403 FORBIDDEN`, and role checks precede Site lookup, including nonexistent codes.
- [ ] A successful soft delete keeps the Step 3 `204` response without a body and removes the Site from public active-Site reads. Persist authenticated `updated_by` and server `updated_at` on the retained Site without changing `created_by`.
- [ ] Existing `409 SITE_HAS_SURVEYS` behavior and Site-row locking remain intact for a linked Survey, including under concurrent Survey writes.
- [ ] OpenAPI and README document the protected delete route. Real HTTP/PostGIS tests cover roles, missing Sites, linked Surveys, retained audit values, and unchanged deletion semantics; adapt existing write tests to admin credentials.
