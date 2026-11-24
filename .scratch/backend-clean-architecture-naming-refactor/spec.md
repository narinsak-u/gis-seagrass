# Backend Clean Architecture Flat Layers & Naming Refactor

Status: ready-for-agent

## Problem Statement

The backend already enforces a modular monolith with physical Clean Architecture layers, but navigating a single request path requires descending through several single- or two-file subdirectories inside each feature module (such as separate subfolders for HTTP DTOs, application contracts, application use cases, security helpers, infrastructure repositories, and transaction wrappers). At the same time, file naming mixes hyphenated and dotted conventions inconsistently across features, and the HTTP layer is named `http` rather than `presentation`, making responsibilities harder to scan at a glance even though the underlying architecture is sound.

## Solution

Flatten the unnecessary nested subdirectories inside each backend feature module while preserving all four physical Clean Architecture layers—`domain`, `application`, `infrastructure`, and `presentation`—and adopt clear, responsibility-based file naming conventions across Auth, Sites, Surveys, Site–Survey workflows, and Import. Preserve every existing class responsibility, public module export, dependency boundary, database behavior, REST API contract, RBAC rule, spatial invariant, concurrency guarantee, and CLI import behavior. Update the automated architecture checks and active architecture documentation to reflect and enforce the flattened structure.

## User Stories

1. As a backend maintainer, I want each HTTP feature module (`auth`, `sites`, `surveys`) to expose four flat top-level layers (`domain`, `application`, `infrastructure`, `presentation`), so that I can trace a request from controller to persistence without traversing redundant nested folders.
2. As a backend maintainer, I want the `http` layer renamed to `presentation`, so that the folder structure uses standard Clean Architecture layer names consistently across features.
3. As a backend maintainer, I want retired nested subfolders (`http`, `dto`, `contracts`, `use-cases`, `repositories`, `transactions`, `security`) removed from flattened feature layers, so that small modules stay shallow and scannable.
4. As a backend maintainer, I want application orchestration files and classes to keep role-honest names (`AuthService`, `SiteQueries`, `SurveyCommands`, `SiteSurveyCoordinator`), so that read-only, write-only, and cross-feature coordinator responsibilities are never obscured behind generic service labels.
5. As a backend maintainer, I want repository ports in the application layer and Drizzle repository adapters in the infrastructure layer to follow predictable role-based dot-suffix naming, so that ports and concrete database implementations are immediately distinguishable.
6. As a backend maintainer, I want non-repository application ports (such as the Site–Survey read port and the transaction-runner port) to use a consistent port suffix, so that every boundary contract in the application layer is recognizable without a separate contracts subfolder.
7. As a backend maintainer, I want presentation files (controllers, guards, DTOs, validation helpers, and OpenAPI definitions) to use consistent role suffixes with feature-plural naming where appropriate, so that HTTP transport artifacts are easy to locate.
8. As a backend maintainer, I want domain files to keep singular domain-concept names and avoid redundant single-line barrel files, so that domain rules stay concise and uniform across Sites, Surveys, and Auth.
9. As a backend maintainer, I want Auth token and password security helpers flattened directly into Auth's application layer without adding a pass-through crypto port, so that authentication stays simple and free of artificial interfaces.
10. As a backend maintainer, I want separate Site read and write repositories and separate Survey list, write, status, and constraint repositories preserved rather than merged, so that distinct query and transaction paths stay decoupled.
11. As a backend maintainer, I want the Site–Survey transaction context and runner port to remain opaque in the application layer while Drizzle transaction unwrapping stays solely in infrastructure, so that cross-feature workflows stay database-independent.
12. As a backend maintainer, I want the standalone Import CLI module to flatten its application use-case subfolder into role-named import operations while keeping its parser, application, and infrastructure structure distinct from HTTP features, so that CLI orchestration remains clean and decoupled from Nest HTTP startup and DTOs.
13. As a backend maintainer, I want platform and shared foundations left structurally unchanged, so that the refactor stays tightly scoped to feature layer flattening and naming clarity.
14. As a backend maintainer, I want the automated architecture check updated to verify the four-layer layout, dependency direction, public module exports, composition-root exceptions, single database-module registration, and prevention of retired legacy subfolders without hardcoding optional filenames, so that architectural boundaries cannot silently regress while remaining flexible for legitimate growth.
15. As an API consumer, I want all Site endpoints (list, detail, GeoJSON bbox, create, update, soft delete) to preserve exact routes, payloads, status codes, error envelopes, validation precedence, and OpenAPI documentation, so that clients experience zero breaking changes.
16. As a Site visitor, I want Site status to continue deriving dynamically from Surveys on the Site's most recent observation date (or returning no data when none exist), so that refactoring does not alter status semantics.
17. As a Site administrator, I want Site creation, geometry updates, optimistic version-conflict handling, Soft-deleted site code reservation, and active-Survey deletion protection to behave identically, so that data integrity and concurrency guarantees remain intact.
18. As a Survey reader or administrator, I want protected Survey listing and admin-only Survey creation, editing, and deletion to preserve the 50-meter spatial rule, species validation, strict calendar-date checks, actor attribution, and per-Site row locking, so that Survey workflows are unaffected.
19. As a user of protected routes, I want login, token verification, and per-request active-user and role resolution to behave identically after Auth files are flattened, so that RBAC and account-deactivation semantics do not change.
20. As an importer operator, I want repeated seed imports through the standalone CLI to preserve idempotency, advisory locking, rejection counts, and shared Site and Survey write invariants, so that data ingestion remains reliable.
21. As a project maintainer, I want active architecture documentation and ADR references updated (while preserving historical specs and acceptance records with only brief supersession pointers), so that future contributors follow ADR-0002's flattened layout without losing architectural history.

## Implementation Decisions

- **Preserve modular monolith and Clean Architecture invariants:** Retain one NestJS backend application, one independently managed backend package, one PostgreSQL/PostGIS database, and the existing composition roots. Keep domain and application layers completely free of NestJS, Express, HTTP/presentation types, Drizzle, `pg`, and platform database imports. Preserve cross-feature access through public module exports, allowing concrete cross-feature repository wiring only in the Site–Survey workflow module and the standalone Import CLI infrastructure. Preserve single database-module configuration in the root application module.
- **Flatten HTTP feature modules (`auth`, `sites`, `surveys`):** Replace the `http` layer with `presentation`, keeping four flat layers per feature (`domain`, `application`, `infrastructure`, `presentation`). Remove nested `dto`, `contracts`, `use-cases`, `repositories`, and `security` subfolders by moving files directly into their owning layer. Keep tests and module composition roots/barrels at each feature root.
- **Role-honest application entrypoints:** Preserve existing application class names and responsibilities (`AuthService`, `SiteQueries`, `SurveyCommands`, `SiteSurveyCoordinator`) and align filenames directly with those roles instead of renaming read-only, write-only, or coordinator classes to generic service names.
- **Consistent role-based dot-suffix naming:**
  - Use a repository suffix for persistence ports in the application layer and a Drizzle-prefixed repository suffix for concrete implementations in infrastructure. Keep separate read, write, list, status, and constraint repositories unmerged.
  - Use a port suffix consistently for all non-repository application ports (the Site–Survey read port and the Site–Survey transaction-runner port), preserving all existing interfaces, opaque transaction types, and DI tokens.
  - Use controller, guard, DTO, validation, and OpenAPI role suffixes in `presentation`, adopting feature-plural naming for Sites and Surveys presentation artifacts and `auth` naming for Auth.
  - Keep singular domain-concept naming in `domain`, mark Site status derivation explicitly as domain rules, keep Survey calendar-date rules singular, and remove the redundant single-line Survey domain barrel so the feature barrel imports the date rule directly.
- **Keep Auth token security helper in Application:** Flatten the Auth token/password helper directly into Auth's application layer without creating a new crypto port interface; preserve secret validation, token signing/verification, password hashing, and root module re-export behavior.
- **Flatten Site–Survey workflows:** Flatten the workflow coordinator and transaction-runner port directly into its application layer and flatten the Drizzle transaction runner and transaction unwrap adapter directly into its infrastructure layer. Keep the opaque transaction seam unchanged so only infrastructure unwraps Drizzle transactions.
- **Flatten Import application layer only:** Flatten Import's application use-case subfolder into role-named Site and Survey import orchestration modules while keeping its parser and infrastructure layers and standalone CLI entrypoint intact. Update Import infrastructure composition and test imports to point to the relocated modules.
- **Leave platform and shared layers structurally unchanged:** Keep platform database, migrations, schema, health, error handling, and shared geospatial/error/input utilities in their existing structure; update only the static architecture test in platform.
- **Update static architecture enforcement:** Update the architecture test suite to require `presentation`, `application`, `domain`, and `infrastructure` on HTTP features (and the corresponding layers on Site–Survey workflows and Import), reject re-introduction of retired nested folders (`http`, `dto`, `contracts`, `use-cases`, `repositories`, `transactions`, `security`) inside flattened feature layers, block both `presentation` and `http` imports from domain/application code, and update the cross-module Drizzle transaction adapter exception path. Do not hardcode optional filenames or ban legitimate future subfolders.
- **Documentation and ADR alignment:** Follow accepted ADR-0002 (which supersedes only ADR-0001's physical subfolder and file-naming conventions while preserving all dependency and workflow rules). Update the project design document and specs roadmap to describe the active flat layout, and add brief supersession pointers to ADR-0001 and the two completed historical architecture specs without rewriting historical acceptance records.

## Testing Decisions

- **What makes a good test:** Verify externally observable behavior and architectural invariants rather than mocking internal DI wiring, repository methods, or private helpers. Keep existing behavioral assertions unchanged; update only import paths where test files reference relocated modules.
- **Testing seams (all existing, highest-level seams executed together via the backend test command against isolated PostGIS):**
  1. **Static build and architecture seam:** Full TypeScript compilation plus the static compiler-API architecture test suite. Verifies the four flat physical layers, rejects retired nested subfolders inside flattened feature layers, enforces Domain/Application independence from NestJS, Presentation/HTTP, Drizzle, `pg`, and platform database code, verifies public module barrels, enforces composition-root exceptions, and confirms single database-module registration.
  2. **Full HTTP / NestJS integration seam:** Existing Auth, Sites (CRUD, GeoJSON bbox, Swagger/OpenAPI docs), and Surveys integration suites booting the real root application module against a disposable PostGIS database. Verifies all routes, response shapes, DTO validation and error envelopes, RBAC and active-user checks, PostGIS spatial rules, derived Site status, Soft-deleted site reservation, optimistic locking (`VERSION_CONFLICT`), and Swagger output remain unchanged.
  3. **Standalone Importer CLI seam:** Existing Province, Species, Site, and Survey importer test suites exercising the standalone CLI entrypoint and import operations directly against disposable PostGIS without starting Nest. Verifies idempotency, rejection reporting, advisory locking, and shared Site/Survey write invariants.
- **Prior art:** The backend Node test runner already runs the static architecture suite alongside real Nest HTTP and standalone importer integration suites against a disposable PostGIS instance configured via `IMPORT_TEST_DATABASE_URL`.

## Out of Scope

- Any new product features or Step 6–9 work (map UI, status filtering changes, editing UI, dashboard, exports, or production hardening).
- Any behavioral changes to HTTP routes, response shapes, error codes/envelopes, validation rules, RBAC permissions, JWT handling, PostGIS calculations, Site status derivation, or concurrency/locking semantics.
- Database schema changes, migration edits, or seed source-data modifications.
- Merging separate read/write or role-specific repositories into monolithic repositories, renaming role-specific classes to generic `*Service` names, or adding pass-through interfaces (such as a crypto port for Auth tokens).
- Restructuring `platform/`, `shared/`, `frontend/`, Docker Compose, or package management layout.

## Further Notes

- This refactor is preparatory architecture work and must use the `refactor:` Git commit prefix (never `step-N:`). Do not start Step 6 automatically after completing this refactor.
- Detailed file-by-file rename targets and acceptance checklists live in the confirmed architecture specification alongside accepted ADR-0002.
- Independent verification against the confirmed spec, tickets, ADR-0002, build, and full disposable PostGIS test suite is required before final commit.
