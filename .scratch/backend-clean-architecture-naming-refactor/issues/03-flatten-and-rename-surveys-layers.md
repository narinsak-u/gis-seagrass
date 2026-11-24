# 03: Flatten and rename Surveys layers

**What to build:** Authenticated Survey readers and administrators retain identical Survey listing and write behavior—role checks, 50-meter spatial containment, strict calendar-date and species validation, actor attribution, per-Site row locking, and derived Site status updates—while Surveys uses flat `domain`, `application`, `infrastructure`, and `presentation` layers with clear responsibility-based naming.

**Blocked by:** 01: Prepare architecture check for flat-layer transition

**Status:** ready-for-agent

- [ ] Surveys exposes four flat physical layers (`domain`, `application`, `infrastructure`, `presentation`) with no remaining nested `http`, `dto`, `contracts`, `use-cases`, or `repositories` folders.
- [ ] Surveys preserves role-honest `SurveyCommands` and its four distinct repository ports and Drizzle adapters (list, write, status, and Site–Survey constraints) using the repository dot-suffix convention, and uses consistent feature-plural presentation naming for its controller, DTOs, validation helpers, and OpenAPI definitions.
- [ ] The redundant single-line Survey domain barrel is removed so the feature barrel imports calendar-date domain rules directly.
- [ ] Surveys' module wiring, public barrel exports, `SiteSurveyModule` composition wiring, and Import CLI composition wiring compile cleanly without altering Survey behavior or public exports.
- [ ] Existing Survey HTTP, PostGIS, validation, RBAC, and concurrency tests pass against disposable PostGIS alongside the backend build and architecture check.
