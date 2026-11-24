# Backend Refactor — Clear Naming & Flat Clean Architecture Layers

**Project:** GIS Seagrass  
**Type:** Architecture-only refactor (no feature Step number)  
**Status:** Confirmed — ready for ticketing and implementation (superseding layout/naming recorded in `docs/adr/0002-flat-clean-architecture-naming.md`)  
**Scope:** `backend/` only  
**Git prefix:** `refactor:`

## 1. Goal

Keep the existing **modular monolith + full Clean Architecture**, while making file names reflect responsibilities and removing unnecessary subfolder nesting. Preserve the four logical layers in each HTTP business feature: **domain → application → infrastructure / presentation**. No behavioral, database, API, security, or workflow change is authorized by this refactor.

**Primary outcomes**
- Clear, predictable navigation along each feature's real path: e.g. `sites.controller.ts → site-queries.ts → site-read.repository.ts` (application port) → `drizzle-site-read.repository.ts` (adapter).
- Role-honest application filenames and class names (`AuthService`, `SiteQueries`, `SurveyCommands`, `SiteSurveyCoordinator`) rather than forcing generic `*Service` names onto read-only, write-only, or cross-feature coordinator classes.
- Consistent role-based dot suffixes (`*.repository.ts`, `*.port.ts`, `*.controller.ts`, `*.dto.ts`, `*.openapi.ts`, `*.validation.ts`, `*.rules.ts`) where those responsibilities actually exist.
- Keep interfaces only for real boundaries; do not create empty entities, rules, DTOs, services, ports, or repositories to fill a template.
- Keep current feature boundaries, transaction behavior, Nest module wiring, CLI importer, and test coverage intact.

## 2. Confirmed design decisions (Q1–Q8)

1. **Role-honest application filenames and classes:** Preserve existing class names and responsibilities:
   - `auth/application/auth.service.ts` → `AuthService`
   - `sites/application/site-queries.ts` → `SiteQueries`
   - `surveys/application/survey-commands.ts` → `SurveyCommands`
   - `site-survey-workflows/application/site-survey-coordinator.ts` → `SiteSurveyCoordinator`
2. **`auth-token.ts` stays in Application:** Flatten `auth/application/security/auth-token.ts` to `auth/application/auth-token.ts`. Do not introduce an extra crypto/token port interface solely for this refactor.
3. **Consistent role-based dot suffixes & clean barrels:**
   - `*.repository.ts` for repository ports in `application/` and `drizzle-*.repository.ts` for Drizzle adapters in `infrastructure/`
   - `*.port.ts` for all non-repository application ports (`site-survey-read.port.ts`, `transaction-runner.port.ts`)
   - `*.controller.ts`, `*.guard.ts`, `*.dto.ts`, `*.openapi.ts`, `*.validation.ts` in `presentation/`, using feature-plural names for Sites and Surveys presentation files (`sites.*`, `surveys.*`) and `auth.*` for Auth
   - Singular domain concept names (`actor.ts`, `site-feature.ts`, `site-status.rules.ts`, `site.types.ts`, `calendar-date.ts`), and remove the redundant one-line `surveys/domain/index.ts` barrel so `surveys/index.ts` imports `./domain/calendar-date` directly
4. **Flatten `import/application/` only; leave `platform/` and `shared/` structurally unchanged:** Move `import/application/use-cases/sites.ts` → `import/application/import-sites.ts` and `import/application/use-cases/surveys.ts` → `import/application/import-surveys.ts`. Update cross-feature imports in `import/infrastructure/site-survey-operations.ts` and tests. Leave `platform/` and `shared/` structure unchanged (updating `platform/architecture.test.ts` rules only).
5. **Architecture tests enforce layers, dependency direction, and retired-folder prevention:** Update `backend/src/platform/architecture.test.ts` to require `presentation/`, `application/`, `domain/`, `infrastructure/` on HTTP features (`application/`, `infrastructure/` on `site-survey-workflows`; `parser/`, `application/`, `infrastructure/` on `import`), forbid re-introducing retired nested folders (`http/`, `dto/`, `contracts/`, `use-cases/`, `repositories/`, `transactions/`, `security/`) inside flattened feature layers, preserve dependency-direction checks (blocking `presentation` and `http` from `application`/`domain`), public module exports, composition-root exceptions, and single `DatabaseModule` registration. Do not hardcode optional filenames or prohibit legitimate future subfolders.
6. **ADR and documentation strategy:** `docs/adr/0002-flat-clean-architecture-naming.md` supersedes only the physical layout and naming rules of `docs/adr/0001-physical-backend-layers.md`, preserving all Clean Architecture dependency and workflow rules. During implementation, update `DESIGN.md`, `specs/README.md`, and add short supersession notes to ADR-0001 and the two completed historical architecture specs (`specs/backend-architecture-refactor.md`, `specs/backend-architecture-structure.md`) without rewriting historical acceptance evidence.

## 3. Target architecture

```text
backend/
├── src/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.test.ts
│   │   ├── domain/
│   │   │   └── actor.ts
│   │   ├── application/
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts
│   │   │   └── auth-token.ts
│   │   ├── infrastructure/
│   │   │   └── drizzle-auth.repository.ts
│   │   └── presentation/
│   │       ├── auth.controller.ts
│   │       ├── auth.guard.ts
│   │       └── auth.dto.ts
│   ├── sites/
│   │   ├── index.ts
│   │   ├── sites.module.ts
│   │   ├── sites.test.ts
│   │   ├── sites.geojson.test.ts
│   │   ├── sites.docs.test.ts
│   │   ├── domain/
│   │   │   ├── site-feature.ts
│   │   │   ├── site-status.rules.ts
│   │   │   └── site.types.ts
│   │   ├── application/
│   │   │   ├── site-queries.ts
│   │   │   ├── site-read.repository.ts
│   │   │   ├── site-write.repository.ts
│   │   │   └── site-survey-read.port.ts
│   │   ├── infrastructure/
│   │   │   ├── drizzle-site-read.repository.ts
│   │   │   └── drizzle-site-write.repository.ts
│   │   └── presentation/
│   │       ├── sites.controller.ts
│   │       ├── sites-geojson.controller.ts
│   │       ├── sites.dto.ts
│   │       └── sites.openapi.ts
│   ├── surveys/
│   │   ├── index.ts
│   │   ├── surveys.module.ts
│   │   ├── surveys.test.ts
│   │   ├── domain/
│   │   │   └── calendar-date.ts
│   │   ├── application/
│   │   │   ├── survey-commands.ts
│   │   │   ├── survey-list.repository.ts
│   │   │   ├── survey-write.repository.ts
│   │   │   ├── survey-status.repository.ts
│   │   │   └── site-survey-constraint.repository.ts
│   │   ├── infrastructure/
│   │   │   ├── drizzle-survey-list.repository.ts
│   │   │   ├── drizzle-survey-write.repository.ts
│   │   │   ├── drizzle-survey-status.repository.ts
│   │   │   └── drizzle-site-survey-constraint.repository.ts
│   │   └── presentation/
│   │       ├── surveys.controller.ts
│   │       ├── surveys.dto.ts
│   │       ├── surveys.validation.ts
│   │       └── surveys.openapi.ts
│   ├── site-survey-workflows/
│   │   ├── index.ts
│   │   ├── site-survey.module.ts
│   │   ├── application/
│   │   │   ├── site-survey-coordinator.ts
│   │   │   └── transaction-runner.port.ts
│   │   └── infrastructure/
│   │       ├── drizzle-transaction-runner.ts
│   │       └── drizzle-transaction.ts
│   ├── import/
│   │   ├── run.ts
│   │   ├── province.test.ts
│   │   ├── sites.test.ts
│   │   ├── species.test.ts
│   │   ├── surveys.test.ts
│   │   ├── parser/
│   │   │   ├── province.ts
│   │   │   ├── sites.ts
│   │   │   ├── species.ts
│   │   │   └── surveys.ts
│   │   ├── application/
│   │   │   ├── import-sites.ts
│   │   │   └── import-surveys.ts
│   │   └── infrastructure/
│   │       ├── advisory-lock.ts
│   │       ├── reference-data.ts
│   │       └── site-survey-operations.ts
│   ├── platform/                     # unchanged structure; architecture.test.ts updated
│   ├── shared/                       # unchanged structure
│   ├── app.module.ts
│   ├── main.ts
│   └── swagger.ts
└── package.json                      # independent npm application
```

`platform/database/schema/` continues to own Drizzle database schema; `*.dto.ts` owns HTTP validation. Keep the Import module intentionally different because it is a standalone CLI, not an HTTP feature.

## 4. Naming and placement rules

| Responsibility | Layer | Convention |
| --- | --- | --- |
| Pure domain behavior, status, and GIS invariants | `domain/` | Singular domain names: `actor.ts`, `site-feature.ts`, `site-status.rules.ts`, `site.types.ts`, `calendar-date.ts` |
| Application orchestration / use cases | `application/` | Role-honest names matching class/function responsibilities: `auth.service.ts`, `site-queries.ts`, `survey-commands.ts`, `site-survey-coordinator.ts`, `import-sites.ts`, `import-surveys.ts` |
| Repository interface/port required by application | `application/` | `*.repository.ts` (`auth.repository.ts`, `site-read.repository.ts`, `survey-write.repository.ts`, etc.) |
| Non-repository application port | `application/` | `*.port.ts` (`site-survey-read.port.ts`, `transaction-runner.port.ts`) |
| Application-local security helper | `application/` | `auth-token.ts` |
| Drizzle/PostGIS repository adapter | `infrastructure/` | `drizzle-*.repository.ts` |
| Drizzle transaction infrastructure | `infrastructure/` | `drizzle-transaction-runner.ts`, `drizzle-transaction.ts` |
| Nest HTTP routes, guards, DTOs, validation, OpenAPI | `presentation/` | `*.controller.ts`, `*.guard.ts`, `*.dto.ts`, `*.validation.ts`, `*.openapi.ts` |
| DI registration and public module barrel | Feature root | `*.module.ts`, `index.ts` |
| Database migrations and table definitions | `platform/database/` | Existing migration and schema names unchanged |

**Key distinction:** An `application/*.repository.ts` is an interface/port (and DI token), **not SQL**. SQL and Drizzle stay in `infrastructure/`. Application depends on domain and ports; concrete adapters implement ports and are wired in Nest or CLI composition roots. Do not merge read and write repositories or distinct Survey ports just to reduce file count.

## 5. Exact file-by-file mapping

### Auth (`backend/src/auth/`)

| Existing path | Target path | Notes |
| --- | --- | --- |
| `auth/application/use-cases/auth-service.ts` | `auth/application/auth.service.ts` | Preserve `AuthService` |
| `auth/application/contracts/auth-repository.ts` | `auth/application/auth.repository.ts` | Preserve `AuthRepository`, `AUTH_REPOSITORY` |
| `auth/application/security/auth-token.ts` | `auth/application/auth-token.ts` | Preserve functions and `requireJwtSecret` re-export |
| `auth/infrastructure/repositories/drizzle-auth-repository.ts` | `auth/infrastructure/drizzle-auth.repository.ts` | Preserve `DrizzleAuthRepository` |
| `auth/http/auth.controller.ts` | `auth/presentation/auth.controller.ts` | Preserve `AuthController` |
| `auth/http/auth.guard.ts` | `auth/presentation/auth.guard.ts` | Preserve `AuthGuard`, `Roles`, `AuthenticatedRequest` |
| `auth/http/dto/auth.dto.ts` | `auth/presentation/auth.dto.ts` | Preserve `LoginDto` |

Unchanged: `auth/auth.module.ts` (imports updated), `auth/auth.test.ts` (imports updated if needed), `auth/domain/actor.ts`.

### Sites (`backend/src/sites/`)

| Existing path | Target path | Notes |
| --- | --- | --- |
| `sites/domain/site-status.ts` | `sites/domain/site-status.rules.ts` | Preserve `deriveSiteStatus`, `SiteStatus` |
| `sites/application/use-cases/site-queries.ts` | `sites/application/site-queries.ts` | Preserve `SiteQueries` |
| `sites/application/contracts/site-read-repository.ts` | `sites/application/site-read.repository.ts` | Preserve `SiteReadRepository`, `SITE_READ_REPOSITORY` |
| `sites/application/contracts/site-write-repository.ts` | `sites/application/site-write.repository.ts` | Preserve `SiteWriteRepository`, `SITE_WRITE_REPOSITORY` |
| `sites/application/contracts/site-survey-read-contract.ts` | `sites/application/site-survey-read.port.ts` | Preserve `SiteSurveyReadContract` |
| `sites/infrastructure/repositories/drizzle-site-read-repository.ts` | `sites/infrastructure/drizzle-site-read.repository.ts` | Preserve `DrizzleSiteReadRepository` |
| `sites/infrastructure/repositories/drizzle-site-write-repository.ts` | `sites/infrastructure/drizzle-site-write.repository.ts` | Preserve `DrizzleSiteWriteRepository` |
| `sites/http/sites.controller.ts` | `sites/presentation/sites.controller.ts` | Preserve `SitesController` |
| `sites/http/sites.geojson.controller.ts` | `sites/presentation/sites-geojson.controller.ts` | Preserve `SitesGeoJsonController` |
| `sites/http/dto/site.dto.ts` | `sites/presentation/sites.dto.ts` | Preserve DTO classes |
| `sites/http/site-openapi.ts` | `sites/presentation/sites.openapi.ts` | Preserve OpenAPI constants |

Unchanged: `sites/sites.module.ts` (imports updated), `sites/index.ts` (imports updated), `sites/domain/site-feature.ts`, `sites/domain/site.types.ts`, `sites/sites.test.ts`, `sites/sites.geojson.test.ts`, `sites/sites.docs.test.ts`.

### Surveys (`backend/src/surveys/`)

| Existing path | Target path | Notes |
| --- | --- | --- |
| `surveys/domain/index.ts` | *(remove)* | Redundant 1-line barrel; `surveys/index.ts` imports `./domain/calendar-date` directly |
| `surveys/application/use-cases/survey-commands.ts` | `surveys/application/survey-commands.ts` | Preserve `SurveyCommands` |
| `surveys/application/contracts/site-survey-constraint-repository.ts` | `surveys/application/site-survey-constraint.repository.ts` | Preserve `SiteSurveyConstraintRepository`, token |
| `surveys/application/contracts/survey-list-repository.ts` | `surveys/application/survey-list.repository.ts` | Preserve `SurveyListRepository`, token |
| `surveys/application/contracts/survey-status-repository.ts` | `surveys/application/survey-status.repository.ts` | Preserve `SurveyStatusRepository`, token |
| `surveys/application/contracts/survey-write-repository.ts` | `surveys/application/survey-write.repository.ts` | Preserve `SurveyWriteRepository`, token |
| `surveys/infrastructure/repositories/drizzle-site-survey-constraint-repository.ts` | `surveys/infrastructure/drizzle-site-survey-constraint.repository.ts` | Preserve class |
| `surveys/infrastructure/repositories/drizzle-survey-list-repository.ts` | `surveys/infrastructure/drizzle-survey-list.repository.ts` | Preserve class |
| `surveys/infrastructure/repositories/drizzle-survey-status-repository.ts` | `surveys/infrastructure/drizzle-survey-status.repository.ts` | Preserve class |
| `surveys/infrastructure/repositories/drizzle-survey-write-repository.ts` | `surveys/infrastructure/drizzle-survey-write.repository.ts` | Preserve class |
| `surveys/http/surveys.controller.ts` | `surveys/presentation/surveys.controller.ts` | Preserve `SurveysController` |
| `surveys/http/dto/survey.dto.ts` | `surveys/presentation/surveys.dto.ts` | Preserve DTO classes |
| `surveys/http/survey-validation.ts` | `surveys/presentation/surveys.validation.ts` | Preserve validation functions |
| `surveys/http/survey-openapi.ts` | `surveys/presentation/surveys.openapi.ts` | Preserve OpenAPI constants |

Unchanged: `surveys/surveys.module.ts` (imports updated), `surveys/index.ts` (imports updated), `surveys/domain/calendar-date.ts`, `surveys/surveys.test.ts`.

### Site–Survey Workflows (`backend/src/site-survey-workflows/`)

| Existing path | Target path | Notes |
| --- | --- | --- |
| `site-survey-workflows/application/use-cases/site-survey-coordinator.ts` | `site-survey-workflows/application/site-survey-coordinator.ts` | Preserve `SiteSurveyCoordinator` |
| `site-survey-workflows/application/contracts/transaction-runner.ts` | `site-survey-workflows/application/transaction-runner.port.ts` | Preserve `SiteSurveyTransactionRunner`, `SiteWriteTransaction`, `SITE_SURVEY_TRANSACTION_RUNNER` |
| `site-survey-workflows/infrastructure/transactions/drizzle-transaction-runner.ts` | `site-survey-workflows/infrastructure/drizzle-transaction-runner.ts` | Preserve classes/factory/provider |
| `site-survey-workflows/infrastructure/transactions/drizzle-transaction.ts` | `site-survey-workflows/infrastructure/drizzle-transaction.ts` | Preserve unwrap helper and type |

Unchanged: `site-survey-workflows/site-survey.module.ts` (imports updated), `site-survey-workflows/index.ts` (imports updated).

### Import (`backend/src/import/`)

| Existing path | Target path | Notes |
| --- | --- | --- |
| `import/application/use-cases/sites.ts` | `import/application/import-sites.ts` | Preserve `importSiteFeatures`, `SiteImportResult` |
| `import/application/use-cases/surveys.ts` | `import/application/import-surveys.ts` | Preserve `importSurveys`, `SurveyImportResult` |

Unchanged: `import/run.ts` (imports updated), `import/parser/*`, `import/infrastructure/*` (`site-survey-operations.ts` imports updated), `import/*.test.ts` (imports updated).

### Platform & Shared (`backend/src/platform/`, `backend/src/shared/`)

Structurally unchanged. Update `backend/src/platform/architecture.test.ts` to enforce the confirmed flat four-layer rules.

## 6. Architecture invariants (must not change)

1. **Four layers remain real:** Domain contains no Nest/Drizzle/HTTP; Application depends on domain and ports, never concrete adapters; Presentation handles HTTP/DTO; Infrastructure implements persistence and external details.
2. **Feature ownership remains:** `sites`, `surveys`, `auth` each own their business rules and persistence. `site-survey-workflows` owns only cross-feature orchestration and transaction boundaries; no circular feature imports.
3. **Transaction seam remains opaque:** `SiteWriteTransaction` and `SiteSurveyTransactionRunner` stay in Application (`transaction-runner.port.ts`); Drizzle casting/unwrapping stays entirely in Infrastructure (`drizzle-transaction.ts`).
4. **Import remains a standalone CLI:** Parsing/reporting remains outside HTTP DTOs; Site and Survey writes reuse owning application operations and `SiteSurveyCoordinator`. Preserve its pinned-session advisory lock and idempotency.
5. **Business behavior unchanged:** JWT/role matrix (including admin-only writes and protected Survey reads), PostGIS validations and 50 m rule, Site version conflict, row locking, survey/date/status semantics, GeoJSON response shape, HTTP status/error envelope, and audit attribution.
6. **Operational behavior unchanged:** One pool-backed Drizzle provider per process; migrations before import/start; Docker Compose startup, `/health`, `/docs`, seed import report, and database schemas remain compatible.
7. **No new features:** No change to Step 6 status filtering, frontend behavior, new endpoints, migration history, permissions, or environment credentials.

## 7. Refactoring approach

1. **Baseline:** Inspect branch/worktree; verify clean baseline build and tests against disposable PostGIS and record results.
2. **Ticketing (when requested):** Record `.scratch/backend-clean-architecture-naming-refactor/spec.md` and implementation tickets based on this confirmed spec.
3. **Move by feature:** Sites → Surveys → Auth → Site–Survey workflows → Import. Use Git-aware renames; update relative imports, module barrels, injection tokens, and Nest/CLI composition roots. Keep public exports and symbols stable; avoid logic edits.
4. **Update architecture tests:** Update `backend/src/platform/architecture.test.ts` to:
   - Require `presentation/`, `application/`, `domain/`, `infrastructure/` for `auth`, `sites`, `surveys` (`application/`, `infrastructure/` for `site-survey-workflows`; `parser/`, `application/`, `infrastructure/` for `import`).
   - Forbid re-introducing retired legacy folders (`http/`, `dto/`, `contracts/`, `use-cases/`, `repositories/`, `transactions/`, `security/`) inside flattened feature layers, without hardcoding optional filenames or banning legitimate future subfolders.
   - Block `presentation` and `http` (alongside `infrastructure`, NestJS, Express, Drizzle, `pg`, and `platform/database`) from `application/` and `domain/`.
   - Update the `drizzle-transaction` cross-module infrastructure exception path to `site-survey-workflows/infrastructure/drizzle-transaction`.
   - Preserve public export matrix, composition-root exceptions, and single `DatabaseModule` registration checks.
5. **Update active docs:** Update `DESIGN.md` and `specs/README.md` to reflect the active flat layout, and add short supersession pointers to `docs/adr/0001-physical-backend-layers.md`, `specs/backend-architecture-refactor.md`, and `specs/backend-architecture-structure.md` without rewriting historical acceptance records.
6. **Verify behavior:** Run `npm run build` and `npm test` from `backend/` against a disposable PostGIS DB. Review `git diff` to confirm zero unintended behavioral changes.
7. **Independent audit and commit:** Run `verify` against this confirmed spec, `.scratch/` tickets, ADR-0002, and code. Fix/reverify; commit with `refactor:` prefix only when verified. Stop before any feature Step.

## 8. Testing requirements

- Architecture check: no Domain/Application import of NestJS/HTTP/Presentation/Drizzle/`pg` or peer feature's private Infrastructure; no circular imports; no retired legacy subfolders (`http/`, `dto/`, `contracts/`, `use-cases/`, `repositories/`, `transactions/`, `security/`) inside flattened feature layers; outer-layer adapters wired only in authorized composition roots; single `DatabaseModule` registration in `AppModule`.
- Application/Infrastructure: application classes depend on ports, transaction context is not unwrapped outside Infrastructure, no SQL migrated into Presentation or Application.
- HTTP regression: all Site/Survey/Auth routes, response bodies, validation/error precedence, role permissions, 401/403, and Swagger document remain unchanged.
- PostGIS regression: geometry validity, province/area, within-50 m Survey rule, Site PATCH/Survey creation concurrency, 409 `VERSION_CONFLICT`, Survey status calculation, and soft delete.
- Import regression: running import twice remains idempotent, rejected-record report and counts remain stable; no seed or migration changes.
- Operational checks: API startup/health, direct importer CLI, and dependency injection compile and run. Preserve existing tests rather than weakening assertions.

## 9. Acceptance criteria

- [ ] `sites`, `surveys`, and `auth` retain four physical layers (`presentation/`, `application/`, `domain/`, `infrastructure/`), and all retired nested folders (`http/`, `dto/`, `contracts/`, `use-cases/`, `repositories/`, `transactions/`, `security/`) are flattened.
- [ ] `site-survey-workflows` (`application/`, `infrastructure/`) and `import` (`parser/`, `application/`, `infrastructure/`) match the exact file-by-file mapping in Section 5; `surveys/domain/index.ts` is removed; `platform/` and `shared/` structure is unchanged.
- [ ] Role-honest application filenames/classes (`AuthService`, `SiteQueries`, `SurveyCommands`, `SiteSurveyCoordinator`) and role-based dot suffixes (`*.repository.ts`, `*.port.ts`, `*.controller.ts`, `*.dto.ts`, `*.openapi.ts`, `*.validation.ts`, `*.rules.ts`) are applied consistently.
- [ ] All imports, Nest module registrations, DI tokens, public module exports, and standalone importer bindings work without behavioral edits.
- [ ] Cross-module Site–Survey transaction/locking rules are unchanged; `SiteSurveyTransactionRunner` and `SiteWriteTransaction` remain opaque behind `transaction-runner.port.ts`.
- [ ] No functional changes to endpoints, role permissions, validation, PostGIS, status computation, migration history, or seed data.
- [ ] `backend/src/platform/architecture.test.ts` enforces the flat four-layer layout, bans retired legacy subfolders in feature layers, and preserves dependency-direction and composition-root guards without hardcoding optional filenames.
- [ ] Backend build and full existing test suite pass against isolated PostGIS; no tracked seed files or unrelated resources changed.
- [ ] `docs/adr/0002-flat-clean-architecture-naming.md` is accepted, `DESIGN.md` and `specs/README.md` reflect the active layout, and ADR-0001 plus the two historical architecture specs carry short supersession notes without rewriting historical evidence.
- [ ] Independent `verify` results and any limitations are reported before final commit.

## 10. Git and deliverables

**Commit prefix:** `refactor:` (preparatory architecture work, **not** Step 6).

Suggested commits:

```text
refactor: flatten sites and surveys clean architecture layers
refactor: flatten auth, workflow, and import layers with role-based naming
refactor: update architecture tests and layer layout docs
```

Deliverables: reorganized backend source matching Section 5, updated DI/public exports, updated `architecture.test.ts`, updated `DESIGN.md` / `specs/README.md` / supersession notes, accepted `docs/adr/0002-flat-clean-architecture-naming.md`, test evidence, and commit hashes. **Do not start Step 6 automatically.**
