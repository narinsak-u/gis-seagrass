# 01: Preserve duplicate-code behavior through Site creation

**What to build:** Site administrators continue to receive the existing `DUPLICATE_CODE` response when they create a Site with a reserved code, while the HTTP module no longer needs PostgreSQL constraint details.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The Site write path translates only the duplicate Site-code constraint into the existing application error code `DUPLICATE_CODE`.
- [ ] Unrelated database errors continue to propagate as internal errors; no broad unique-constraint mapping is added.
- [ ] The real Site HTTP/PostGIS test confirms duplicate creation still returns the existing status and error envelope.
- [ ] Existing Site code reservation and import idempotency behavior remain unchanged.
