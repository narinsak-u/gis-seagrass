# 02: Simplify repository provider wiring

Status: resolved
Blocked by: None

**What to build:** Review Application repository ports and Nest providers in `backend/src/{sites/sites.module.ts,surveys/surveys.module.ts,site-survey-workflows/site-survey.module.ts,auth/auth.module.ts}` and the standalone Import composition in `backend/src/import/infrastructure/site-survey-operations.ts`. Remove provider aliases only where no consumer needs both tokens to resolve to the same instance.

- [x] Inventoried Site-read, province-read, Survey-list, Site-write, Survey-constraint, Survey-status, Survey-write, transaction-runner, and auth port tokens: no concrete-token Nest consumer needs their instance. CLI and development seeding construct adapters directly outside Nest.
- [x] Replaced redundant concrete-provider/`useExisting` pairs with one port `useClass` registration in `SitesModule`, `SurveysModule`, `SiteSurveyModule`, and `AuthModule`; removed the obsolete runner provider constant and its unused import. No shared-identity alias needed retention.
- [x] Preserved module imports, operation exports, database provider, Application ports, and independent Import CLI composition; no repository merge or new abstraction.
- [x] Verified backend build/test typecheck and four focused integration files (21 tests), including Nest startup and real CLI import; the combined isolated PostGIS suite passed 25 files and 81 tests.

## Comments

Provider bindings committed as `44e40df81c`; obsolete import cleanup committed as `a97ef0df28`. Both are on the integration branch.
