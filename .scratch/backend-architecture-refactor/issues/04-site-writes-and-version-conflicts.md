# 04: Move Site writes and version conflicts

**What to build:** Admins can create, update, and retire Sites with the same spatial, audit, and concurrency guarantees; other roles remain read-only.

**Blocked by:** 02: Move authentication into its module; 03: Move public Site reads and status.

**Status:** resolved

- [ ] Site create, name/geometry PATCH, and soft delete require an active admin and preserve existing responses, validation, and shared error behavior.
- [ ] Server audit fields use the authenticated actor and clock; client-supplied audit values cannot impersonate another user.
- [ ] Version checks remain atomic; concurrent same-version PATCH requests yield one success and one conflict containing the current Site Feature.
- [ ] Geometry edits, Survey distance guarantees, Survey-free deletion, and Site-row serialization remain intact through the agreed coordinator.
- [ ] Real HTTP/PostGIS tests cover roles, audit, spatial rules, version races, and deletion races.
