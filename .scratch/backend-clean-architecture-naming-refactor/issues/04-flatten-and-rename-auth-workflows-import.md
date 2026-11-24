# 04: Flatten and rename Auth, Site–Survey workflows, and Import layers

**What to build:** Users of protected routes, Site–Survey write workflows, and standalone CLI seed imports retain identical authentication, per-request active-user/role lookup, opaque cross-feature transaction locking, advisory locking, and idempotent reporting behavior while Auth, Site–Survey workflows, and Import application orchestration are flattened and named by responsibility.

**Blocked by:** 01: Prepare architecture check for flat-layer transition; 02: Flatten and rename Sites layers; 03: Flatten and rename Surveys layers

**Status:** resolved

- [x] Auth exposes four flat physical layers (`domain`, `application`, `infrastructure`, `presentation`) with no remaining nested `http`, `dto`, `contracts`, `use-cases`, `repositories`, or `security` folders; `AuthService`, the Auth repository port/adapter, Auth presentation controller/guard/DTO, and the application-level Auth token helper preserve all existing behavior without introducing a pass-through crypto port.
- [x] Site–Survey workflows exposes flat `application` and `infrastructure` layers with no remaining nested `contracts`, `use-cases`, or `transactions` folders; `SiteSurveyCoordinator` remains role-honest, the transaction-runner port uses the consistent port suffix, and Drizzle transaction unwrapping stays strictly in infrastructure with updated cross-module adapter imports.
- [x] Import flattens its application use-case subfolder into role-named Site and Survey import orchestration modules while keeping its parser, infrastructure, standalone CLI entrypoint, advisory lock, and DTO independence intact.
- [x] Platform and shared foundations remain structurally unchanged.
- [x] Existing Auth, Sites, Surveys, and standalone Importer CLI tests (with updated import paths only) pass against disposable PostGIS alongside the backend build and architecture check.

## Comments

- Resolved on `refactor/backend-clean-architecture-naming` via commit `e33ca09`. Verified with full backend build and 78/78 disposable PostGIS tests.
