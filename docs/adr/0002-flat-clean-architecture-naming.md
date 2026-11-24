---
status: accepted
---

# Flat Clean Architecture Layers and Role-Based Naming

Supersedes the physical subfolder and file-naming conventions of [ADR-0001](0001-physical-backend-layers.md) while preserving all Clean Architecture dependency, ownership, transaction, and composition-root rules.

HTTP features (`auth`, `sites`, `surveys`) use four flat physical layers—`domain/`, `application/`, `infrastructure/`, and `presentation/` (replacing `http/`)—without nested `dto/`, `contracts/`, `use-cases/`, `repositories/`, `security/`, or `transactions/` subfolders. Cross-feature `site-survey-workflows` uses flat `application/` and `infrastructure/` layers, and the standalone CLI `import` module flattens `application/use-cases/` into `application/` while keeping `parser/`, `application/`, and `infrastructure/`.

File names express responsibility directly instead of relying on nested directories:

- Application orchestration keeps role-honest names matching class/function responsibilities (`auth.service.ts` / `AuthService`, `site-queries.ts` / `SiteQueries`, `survey-commands.ts` / `SurveyCommands`, `site-survey-coordinator.ts` / `SiteSurveyCoordinator`, `import-sites.ts`, `import-surveys.ts`) rather than renaming read-only, write-only, or coordinator classes to `*Service`.
- Repository ports use `*.repository.ts` in `application/` and Drizzle implementations use `drizzle-*.repository.ts` in `infrastructure/`.
- Non-repository application ports use `*.port.ts` (`site-survey-read.port.ts`, `transaction-runner.port.ts`).
- Presentation files use `*.controller.ts`, `*.guard.ts`, `*.dto.ts`, `*.validation.ts`, and `*.openapi.ts`, with feature-plural names where appropriate (`sites.*`, `surveys.*`, `auth.*`).
- Domain files keep singular domain-concept names (`actor.ts`, `site-feature.ts`, `site-status.rules.ts`, `site.types.ts`, `calendar-date.ts`), without redundant one-line barrels.
- `auth-token.ts` stays in `auth/application/` without adding a pass-through crypto port.

## Considered Options

- **Keep ADR-0001 nested subfolders (`http/dto`, `application/contracts`, `application/use-cases`, `infrastructure/repositories`):** Rejected because small feature layers required navigating multiple single- or two-file subdirectories to trace one request path.
- **Rename all application entrypoints to `*Service` (`SitesService`, `SurveysService`, `SiteSurveyService`):** Rejected because `SiteQueries` (read-only), `SurveyCommands` (write-only), and `SiteSurveyCoordinator` (cross-feature transaction coordinator) have deliberately distinct ownership that generic `*Service` names would obscure.

## Consequences

- `backend/src/platform/architecture.test.ts` enforces the flat top-level layers and dependency direction and forbids re-introducing the retired nested folders (`http/`, `dto/`, `contracts/`, `use-cases/`, `repositories/`, `transactions/`, `security/`) inside feature layers, without hardcoding optional filenames or blocking legitimate future subfolders.
- All Clean Architecture invariants from ADR-0001 remain unchanged: Domain and Application stay independent of NestJS, HTTP/Presentation, Drizzle, and `pg`; cross-feature access uses public module exports; `SiteSurveyModule` and `import/infrastructure/` remain the only composition-root exceptions for concrete repository wiring; and `SiteWriteTransaction` stays opaque outside infrastructure.
