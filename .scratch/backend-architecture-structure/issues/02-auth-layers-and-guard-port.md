# 02: Restructure Auth and route guard lookups through application

**What to build:** Users keep the same login and protected-route behavior, while Auth has explicit layers and the AuthGuard resolves current account status and role through an application interface.

**Blocked by:** 01: Move platform and shared foundations.

**Status:** resolved

- [x] Auth owns HTTP, application, domain, and infrastructure responsibilities; application/domain code have no NestJS, HTTP, Drizzle, or `pg` dependencies.
- [x] AuthGuard calls the Auth application repository contract for active-user/current-role lookup; a Drizzle repository owns the query.
- [x] Login, token verification, development seeding, disabled-user handling, and role changes preserve current behavior.
- [x] Existing Auth HTTP tests and backend build pass.
