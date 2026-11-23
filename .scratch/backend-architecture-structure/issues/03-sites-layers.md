# 03: Restructure Sites into physical layers

**What to build:** Visitors and admins keep the same Site API behavior while Site responsibilities live in explicit HTTP, application, domain, and infrastructure layers.

**Blocked by:** 01: Move platform and shared foundations; 02: Restructure Auth and route guard lookups through application.

**Status:** resolved

- [x] Sites owns its module and four physical layers; controllers, DTOs, OpenAPI, use cases, Site rules, and Drizzle repositories have clear ownership.
- [x] Site reads, writes, status, audit, validation, soft deletion, version conflicts, and spatial guarantees preserve existing behavior.
- [x] Import can consume Site parsing/application contracts without importing HTTP DTOs or private infrastructure.
- [x] Existing Site HTTP/PostGIS tests and backend build pass.
