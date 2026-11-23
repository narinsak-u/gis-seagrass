# 04: Restructure Surveys and Site–Survey coordination

**What to build:** Survey operations retain their current API and concurrency behavior while Survey and cross-feature workflows use explicit application, domain, HTTP, and infrastructure responsibilities.

**Blocked by:** 01: Move platform and shared foundations; 02: Restructure Auth and route guard lookups through application; 03: Restructure Sites into physical layers.

**Status:** resolved

- [x] Surveys owns its module and four physical layers; HTTP DTOs map to application inputs, and Survey rules remain framework-independent.
- [x] A dedicated Site–Survey application module owns cross-feature workflows and shares an opaque transaction context through module-owned ports.
- [x] Only infrastructure knows Drizzle transaction types; per-Site locking, 50-meter distance rules, species atomicity, actor attribution, and per-Survey rollback remain unchanged.
- [x] Existing Survey and Site/Survey concurrency tests and backend build pass.
