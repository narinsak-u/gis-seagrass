# 01: Prepare architecture check for flat-layer transition

**What to build:** Backend contributors can flatten and rename feature modules one batch at a time while keeping the full backend test suite green on every change, without relaxing dependency-direction or module-boundary protections.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The static architecture check accepts either the legacy nested layout or the target flat four-layer layout (`domain`, `application`, `infrastructure`, `presentation`) for each HTTP feature module during the transition.
- [x] The static architecture check accepts both the legacy nested and flattened layouts for Site–Survey workflows (including the cross-module Drizzle transaction adapter exception) and Import's application layer.
- [x] Domain and application layers remain blocked from importing NestJS, Express, HTTP/presentation layers, Drizzle, `pg`, and platform database code.
- [x] Public module export boundaries, composition-root exceptions (`SiteSurveyModule` and Import CLI infrastructure), and single database-module registration remain strictly enforced.
- [x] Backend TypeScript build and existing test suite pass with zero behavioral changes.

## Comments

- Resolved on `refactor/backend-clean-architecture-naming` via commit `5572807` and later contracted in `b038747` / `524ffe1`. Verified with full backend build and 78/78 disposable PostGIS tests.
