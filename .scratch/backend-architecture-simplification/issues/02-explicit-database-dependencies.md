# 02: Make database dependencies explicit

**What to build:** Backend feature modules declare their database dependency rather than relying on global provider visibility, while API startup and the standalone Import CLI continue to use one configured database provider per process entrypoint.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Nest modules that own Drizzle adapters receive database access through explicit module imports.
- [x] The API continues to share one configured pool-backed Drizzle provider across migrations, startup import, and request handling.
- [x] The standalone Import CLI retains its independent provider lifecycle.
- [x] The real Nest HTTP/PostGIS integration suite boots and exercises the affected feature modules.
- [x] The architecture check enforces dependency direction and approved composition roots without adding folder-name-only rules.
- [x] Existing Site, Survey, Auth, and Import behavior remains unchanged.
