# 01: Add the Drizzle provider and AuthGuard pilot

**What to build:** Protected requests continue to resolve the current active user and role using the new database provider, without changing authentication behavior.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [ ] The API owns one pool-backed Drizzle provider shared by migrations, startup import, and Nest; shutdown closes it once. Health retains its pool-level PostGIS check.
- [ ] The AuthGuard's active-user/current-role lookup uses Drizzle and preserves immediate account disablement and role changes.
- [ ] The standalone CLI can own and close its database provider without starting the Nest application.
- [ ] Backend build and protected-route integration tests pass against disposable PostGIS.
