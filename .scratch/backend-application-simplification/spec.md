# Backend Application & Workflow Simplification

Status: verified locally; portability beyond the isolated PostGIS environment is unverified  
Canonical spec: [`specs/backend-application-simplification.md`](../../specs/backend-application-simplification.md)

## Problem and scope

Clarify backend application ownership and trim demonstrably redundant workflow, DI, or validation code without changing Site/Survey behavior. Preserve the flat Clean Architecture layers in ADR-0002, API and standalone Import CLI composition, opaque transaction context, Site-before-Survey locking, spatial and version rules, HTTP contracts, and importer idempotency. SQL/persistence redesign, migrations, frontend, and new features are out of scope.

## Confirmed decisions

1. `SiteSurveyCoordinator` remains the shared cross-feature transaction boundary. Keep Site import/status/locking methods when they preserve API/CLI reuse or hide cross-feature coupling. Remove a forwarding method only if its replacement clarifies ownership without changing transaction scope, lock order, or validation. `SiteQueries` composes Site reads with Survey status; `ProvinceQueries` maps rows to GeoJSON. No one-use-case-per-endpoint classes.
2. Controllers may call Application operations or an Application-owned read repository port. Keep `SurveysController`'s simple `SurveyListRepository` read instead of adding a forwarding `SurveyQueries` class. Never inject a concrete Infrastructure repository into a controller.
3. Preserve Application-owned ports and Infrastructure implementations. Use one `useClass` provider for a port when no concrete-token consumer needs the instance; keep `useExisting` when shared identity matters. Check API and standalone CLI separately; no global module or generic repository.
4. DTO validation covers ordinary HTTP fields. Keep cross-field Survey checks, calendar dates, raw JSON decimal precision, shared Site feature parsing, and login parser behavior unless contract tests prove equivalent replacements. No Zod migration.
5. Completion requires the backend build, unit tests, and integration/concurrency/import-idempotency tests on isolated disposable PostGIS. Missing `IMPORT_TEST_DATABASE_URL` means acceptance remains open, not passed.

## Implementation tickets

- [01 — Application and workflow ownership](issues/01-application-workflow-ownership.md): review/adjust operation boundaries first.
- [02 — Repository ports and DI](issues/02-repository-di-cleanup.md): remove only redundant provider aliases.
- [03 — Validation equivalence](issues/03-validation-equivalence.md): remove only proven duplicate validation.
- [04 — Regression and documentation](issues/04-regression-documentation.md): verify and document the accepted changes; blocked by 01–03.

Each ticket must record a concrete before/after benefit or a reason to retain existing code. A review that finds no safe simplification must not force a rewrite. Update `DESIGN.md` only for architecture changes that land; no new glossary term or ADR is required by the confirmed decisions.

## Verification evidence

Full backend suite passed against isolated disposable PostGIS: 25/25 files, 81/81 tests, zero skipped. Backend build and test typecheck passed; suite covered CLI execution, concurrency, and import idempotency. Source inspection and independent code/standards review confirmed the four-layer boundaries, Application-owned controller dependencies, workflow ownership, unchanged Site/Survey and HTTP behavior, and no unnecessary abstractions. Review also confirmed unchanged authorization, status calculations, lock order, transaction boundaries, 50-meter checks, optimistic locking, advisory locking, schema, migrations, SQL policy, and frontend.

Portability beyond this isolated PostGIS environment was not tested. The canonical spec was pre-existing untracked user content and is not included in the code commit; local tracker docs remain untracked until safely committed separately.
