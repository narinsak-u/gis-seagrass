# 01: Prepare architecture check for flat-layer transition

**What to build:** Backend contributors can flatten and rename feature modules one batch at a time while keeping the full backend test suite green on every change, without relaxing dependency-direction or module-boundary protections.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The static architecture check accepts either the legacy nested layout or the target flat four-layer layout (`domain`, `application`, `infrastructure`, `presentation`) for each HTTP feature module during the transition.
- [ ] The static architecture check accepts both the legacy nested and flattened layouts for Site–Survey workflows (including the cross-module Drizzle transaction adapter exception) and Import's application layer.
- [ ] Domain and application layers remain blocked from importing NestJS, Express, HTTP/presentation layers, Drizzle, `pg`, and platform database code.
- [ ] Public module export boundaries, composition-root exceptions (`SiteSurveyModule` and Import CLI infrastructure), and single database-module registration remain strictly enforced.
- [ ] Backend TypeScript build and existing test suite pass with zero behavioral changes.
