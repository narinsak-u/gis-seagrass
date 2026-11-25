# Backend Refactor — Application & Workflow Simplification

**Project:** GIS Seagrass Monitoring System  
**Type:** Architecture Refactor  
**Status:** Verified locally; portability beyond the isolated PostGIS environment is unverified
**Scope:** Backend Only  
**Commit Prefix:** `refactor:`

## 1. Objective

Simplify the backend application layer by reducing unnecessary abstractions, improving responsibility ownership, and minimizing dependency injection boilerplate.

**Core principle:**

> Reduce accidental complexity while preserving essential complexity.

This refactor must preserve the existing Full Clean Architecture with four layers:

- `domain/`
- `application/`
- `infrastructure/`
- `presentation/`

Do not introduce new architectural patterns or redesign the module structure.

## 2. Scope

### A. Application & Workflow Simplification — High Priority

Review the responsibilities of:

- `SiteSurveyCoordinator`
- `SiteQueries`
- `SurveyCommands`
- `ProvinceQueries`

**Requirements:**

1. Each application operation must have a clear owner.
2. Keep `SiteSurveyCoordinator` responsible for cross-module coordination and transactional invariants.
3. Reduce unnecessary pass-through methods where they add no meaningful abstraction.
4. Avoid introducing one Use Case class per endpoint.
5. Keep existing Site/Survey locking order, transaction boundaries, and validation behavior unchanged.
6. Preserve CLI Import workflows and their shared business rules.

**Important:** Do not split or merge services merely to reduce file count. Only refactor when it improves clarity or eliminates demonstrable duplication.

**Confirmed decision:** Keep `SiteSurveyCoordinator` as the shared transaction and cross-feature boundary. Its Site import, status-read, and Site-lock methods may remain when they preserve shared API/CLI behavior or hide a cross-feature dependency. Remove a forwarding method only when the replacement makes ownership clearer without changing transaction scope, lock order, or validation. `ProvinceQueries` already shapes GeoJSON; do not remove it just to reduce class count. A simple Survey list read may use its Application-owned repository port directly from the controller; do not add a one-method `SurveyQueries` solely to forward that call.

### B. Repository & Dependency Injection Cleanup — Medium Priority

Review existing Repository Contracts and NestJS Provider registrations.

**Requirements:**

1. Preserve Application-owned Repository Interfaces and Infrastructure implementations.
2. Consolidate repositories only when they genuinely share cohesive responsibilities.
3. Remove redundant Provider aliases only when no consumer depends on shared instance identity.
4. Prefer straightforward NestJS DI configuration.
5. Preserve independent API and Import CLI composition.

**Confirmed decision:** Where only the Application port token is consumed, register the Infrastructure implementation with `useClass` instead of a concrete provider plus `useExisting` alias. Keep `useExisting` where two tokens must identify the same instance. Verify consumers and keep standalone Import CLI composition independent before changing a registration.

**Constraints:**

- Do not introduce a Generic Repository or Base Service abstraction.
- Do not make Application Services depend directly on Drizzle or PostgreSQL.
- Do not introduce global modules solely to simplify DI wiring.

### C. Validation Simplification — Medium Priority

Review the current validation responsibilities in:

- `sites.dto.ts`
- `surveys.dto.ts`
- `surveys.validation.ts`
- `site-feature.ts`
- `login-body-parser.middleware.ts`

**Requirements:**

1. Use NestJS DTO Validation for ordinary HTTP input validation.
2. Keep reusable domain invariants in Domain.
3. Keep database-dependent validations in Application/Infrastructure as appropriate.
4. Remove duplicated validation only when behavior is proven equivalent.
5. Preserve existing request formats, error codes, HTTP statuses, and strict decimal precision rules.

Do not migrate the backend to Zod in this refactor.

**Confirmed decision:** Consolidate only behaviorally equivalent validation. Keep Survey coordinate-pair checks, calendar-date and species rules, raw JSON `cover_percent` precision checks, reusable Site feature parsing for API and Import, and the login parser exception unless an equivalent replacement is proven by contract tests. Do not replace cross-field or lexical checks with DTO decorators alone.

### D. SQL & Persistence — Out of Scope

The Drizzle Query Builder simplification has already been completed.

Do not redesign repositories or rewrite SQL again unless a small change is required by an accepted application-layer refactor.

Preserve complex PostGIS queries and existing transaction behavior.

## 3. Non-Negotiable Constraints

- No REST API contract changes.
- No RBAC or authentication behavior changes.
- No database schema or migration changes.
- No changes to Site Status calculations.
- No changes to spatial validation or the 50-meter Survey distance rule.
- No changes to optimistic locking or `FOR UPDATE`.
- No changes to import idempotency or advisory locking.
- No changes to API error envelopes.
- No new features or frontend changes.

## 4. Suggested Implementation Plan

| Phase | Task | Priority |
|---|---|---|
| 1 | Review application responsibilities and dependency flows | P1 |
| 2 | Simplify `SiteSurveyCoordinator` and related use cases where justified | P1 |
| 3 | Review repository contracts and DI wiring | P2 |
| 4 | Consolidate duplicated validation | P2 |
| 5 | Run regression tests and update documentation | Required |

**Implementation strategy:** Make small, independently testable changes. Keep the existing structure unless a change has a measurable readability or maintenance benefit.

## 5. Verification & Acceptance Criteria

- [x] All existing four-layer boundaries remain intact.
- [x] Controllers depend on Application operations or Application-owned read repository ports, never concrete Infrastructure implementations.
- [x] Cross-module transaction orchestration remains correct.
- [x] Site and Survey operations preserve existing behavior.
- [x] No unnecessary interfaces, services, or provider registrations are introduced.
- [x] Import CLI remains independently executable.
- [x] API response bodies, error codes, statuses, and authorization are unchanged.
- [x] Backend TypeScript build passes.
- [x] Unit tests pass.
- [x] Integration tests pass against isolated PostGIS.
- [x] Concurrency and import idempotency tests pass.
- [x] Documentation reflects accepted changes.

**Completion gate:** Use `IMPORT_TEST_DATABASE_URL` pointing to an isolated disposable PostGIS database for integration, concurrency, and import-idempotency checks. If this database is unavailable, leave those criteria unchecked and do not claim or commit a completed refactor.

Local evidence: full backend suite passed against isolated disposable PostGIS: 25/25 files, 81/81 tests, zero skipped. Backend build and test typecheck passed; suite covered CLI execution, concurrency, and import idempotency. Source inspection and independent code/standards review confirmed the architecture boundaries and unchanged API, authorization, status, locking, transaction, spatial, optimistic-locking, advisory-lock, schema, migration, SQL-policy, and frontend behavior. Portability beyond this isolated PostGIS environment was not tested.

## 6. Workflow

1. Review current Backend Code, ADRs, Specs, and Tests.
2. Confirm only material architectural decisions before implementation.
3. Create `.scratch/backend-application-simplification/spec.md` and focused implementation tickets.
4. Refactor incrementally, starting with Application & Workflow.
5. Run regression tests after each meaningful change.
6. Independently verify the final implementation.
7. Commit verified changes using `refactor:`.
8. Stop after completion; do not start the next feature step automatically.

## Definition of Done

The backend is easier to navigate and maintain, with clearer application responsibilities and fewer unnecessary abstractions, while preserving Full Clean Architecture and all existing functional behavior.