# 03: Keep Site read projections consistent

**What to build:** Site list and GeoJSON reads continue returning the same Site fields and Site statuses, with their repeated public-summary mapping maintained in one place.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Site list responses preserve existing fields, pagination, and Site status values.
- [ ] GeoJSON responses preserve existing feature geometry, properties, and Site status values.
- [ ] Repeated Site-to-public-summary projection is consolidated within the existing Site query implementation.
- [ ] Site detail retains its distinct latest Survey summary behavior.
- [ ] Existing HTTP/PostGIS tests verify the observable responses rather than private helper calls.
