# 01: Clarify application and workflow ownership

Status: resolved
Blocked by: None

**What to build:** Review `backend/src/site-survey-workflows/application/site-survey-coordinator.ts`, `backend/src/sites/application/site-queries.ts`, `backend/src/surveys/application/survey-commands.ts`, `backend/src/sites/application/province-queries.ts`, their controllers, and `backend/src/import/application/{import-sites,import-surveys}.ts`. Make only ownership changes that remove demonstrable duplication or improve navigation without an offsetting class, port, or DI cost.

- [x] Mapped owners: `SiteSurveyCoordinator` keeps transaction and cross-feature Site seams; `SiteQueries` composes Survey status, `ProvinceQueries` shapes GeoJSON, and `SurveyCommands` owns Survey writes/import. Retained boundary methods avoid exposing Site write adapters to Survey code.
- [x] Kept Site import/status/lock methods and their API/CLI callers unchanged; no forwarding class added.
- [x] Kept Survey writes in `SurveyCommands` and direct Application-owned Survey list port in `SurveysController`.
- [x] Extracted the identical update/delete Site-then-Survey lock sequence to `SurveyCommands.lockSurveySite()` without changing transaction scope, `FOR UPDATE`, version or distance checks, errors, or import ordering.
- [x] Verified backend build and four focused integration files (8 tests); the combined isolated PostGIS suite passed 25 files and 81 tests.

## Comments

Shared lock helper committed as `bbbdfebc477e2edda19f3a4cfada3fe697a4b850`; retained coordinator read/import/lock methods preserve their existing cross-feature boundary.
