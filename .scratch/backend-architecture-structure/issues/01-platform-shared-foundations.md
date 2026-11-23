# 01: Move platform and shared foundations

**What to build:** The backend starts and serves its existing health and HTTP behavior through one explicit platform module, with shared errors and input/geospatial rules in owned shared areas.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Platform owns the database provider, migrations, health endpoint, and global HTTP error mapping; API startup and CLI provider lifecycles remain unchanged.
- [x] Shared application errors, generic input checks, and geospatial rules have explicit homes; Site status and Survey date rules move with their feature tickets.
- [x] Existing health, error-envelope, import, and backend build tests pass.
