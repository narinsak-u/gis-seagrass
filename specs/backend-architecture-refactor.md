# Backend Architecture Refactor

> **Layout note:** Physical subfolder and file-naming conventions in this completed historical spec were superseded by [`backend-clean-architecture-naming-refactor.md`](backend-clean-architecture-naming-refactor.md) and [ADR-0002](../docs/adr/0002-flat-clean-architecture-naming.md); historical status and acceptance records below are preserved unchanged.

## Status

Implemented and verified. Backend build and 73/73 tests pass against disposable PostGIS.

## Goal

Refactor the NestJS backend into a modular monolith with pragmatic Clean Architecture layering. Keep one backend application and one PostgreSQL database. Organize code by business module, make dependency direction explicit, and use Drizzle ORM as the default data access tool.

The refactor must preserve the behavior and policies already established in Steps 1–5. It must not add product features or infer acceptance criteria for Steps 6–9.

## Scope

- Restructure Site, Survey, Auth, and import code into clear modules and layers.
- Move database access out of HTTP controllers and into infrastructure repositories.
- Use Drizzle for ordinary PostgreSQL reads and writes.
- Add HTTP DTOs validated with NestJS `ValidationPipe`, `class-validator`, and `class-transformer`.
- Keep PostGIS-specific operations, locking, and other query-builder gaps expressible through Drizzle's SQL support in infrastructure.
- Update `DESIGN.md` to record the resulting architecture and its trade-offs.

## Out of scope

- Changing API routes, response shapes, access policy, database constraints, or documented Site and Survey behavior.
- Replacing PostgreSQL, NestJS, Drizzle migrations, or the separate frontend/backend package setup.
- Implementing future map, dashboard, export, or production features.
- Introducing microservices, a monorepo, generic repository frameworks, or an interface for every query.
- Rewriting existing migrations or changing seed source data.

## Target structure

```text
backend/src/
├── app.module.ts
├── main.ts
├── platform/
│   ├── database/
│   ├── errors/
│   ├── health/
│   └── http/
├── sites/
│   ├── sites.module.ts
│   ├── http/dto/
│   ├── application/
│   │   ├── contracts/
│   │   └── use-cases/
│   ├── domain/
│   └── infrastructure/repositories/
├── surveys/
│   ├── surveys.module.ts
│   ├── http/dto/
│   ├── application/
│   │   ├── contracts/
│   │   └── use-cases/
│   ├── domain/
│   └── infrastructure/repositories/
├── auth/
│   ├── auth.module.ts
│   ├── http/dto/
│   ├── application/
│   │   ├── contracts/
│   │   ├── security/
│   │   └── use-cases/
│   ├── domain/
│   └── infrastructure/repositories/
├── site-survey-workflows/
│   ├── site-survey.module.ts
│   ├── application/
│   │   ├── contracts/
│   │   └── use-cases/
│   └── infrastructure/transactions/
└── import/
    ├── parser/
    ├── application/use-cases/
    └── infrastructure/
```

Each feature keeps clear ownership of its HTTP, application, domain, and persistence behavior. Use `application/contracts` and `application/use-cases`; place DTO classes in `http/dto`; name persistence contracts `*Repository` and Drizzle implementations `Drizzle*Repository` under `infrastructure/repositories`. Keep Import usable as a CLI without Nest or HTTP DTO coupling.

## Architecture rules

1. **Dependency direction points inward.** HTTP code calls application use cases. Application code depends on domain rules and contracts; infrastructure implements repository contracts and other required roles. Domain code must not import NestJS, Drizzle, `pg`, or HTTP types.
2. **Nest modules compose the application.** `AppModule` imports platform and feature modules. Each feature module registers its own controllers and providers and exports only public application contracts and use cases needed by other modules or the CLI.
3. **Use contracts at real seams.** Persistence contracts use `*Repository` names; transaction collaboration uses a role-specific contract such as `SiteSurveyTransactionRunner`. Do not add pass-through interfaces for every query.
4. **Modules own their data access.** Feature application code and controllers must not import peer tables or infrastructure adapters. The `SiteSurveyModule` composition root may bind Site- and Survey-owned repositories to their public contracts. Import infrastructure may compose those same application operations for the standalone CLI. These roots only compose cross-feature operations; they do not implement Site/Survey SQL. Site and Survey SQL remains in their owning repositories; Import may keep SQL for its own persistence. Other cross-feature callers use public contracts and use cases.
5. **Drizzle is the default data access tool.** Use Drizzle's query builder for ordinary reads and writes. Use Drizzle transactions and `sql` support for PostGIS functions, row locks, and queries that need SQL-specific behavior. Keep all such database details in infrastructure.
6. **Keep domain rules framework-independent.** Domain rules should be plain TypeScript and return values or explicit domain errors. Nest exceptions and HTTP response mapping belong in `http` or an outer adapter.
7. **Avoid unnecessary layers.** Keep abstractions only when they create useful locality, testability, or a real substitution seam. Do not add generic CQRS, event buses, or repository bases as part of this refactor.
## HTTP DTO and validation policy

- Define request DTO classes in the owning module's `http` layer.
- Use `class-validator` decorators for request shape, required fields, primitive types, and basic formats/ranges. Use `class-transformer` through Nest's `ValidationPipe` for deliberate input transformation (for example, query parameter conversion).
- Configure one global `ValidationPipe` with transformation, whitelisting, and unknown-field rejection. Use explicit DTO transformations for query values; do not implicitly coerce request-body values.
- Map validation failures to the existing shared error envelope and preserve parser-before-guard behavior for malformed JSON, and guard-before-DTO-validation behavior for parsed protected requests.
- Keep DTOs as transport models. Map them to application inputs rather than passing decorated HTTP classes into domain code.
- Keep business invariants in domain/application code, including authorization, Site/Survey relationships, spatial distance and containment rules, derived Site status, and concurrency/version checks.
- Keep seed/import parsing and validation independent from HTTP DTOs.
- Preserve documented API status codes and error envelope semantics. Tests cover the selected mapping alongside existing HTTP contracts.

## Cross-module collaboration

Site and Survey behavior has shared invariants: Site status is derived from Survey rows, Survey writes require an active Site, and Site and Survey writes serialize per Site where required. The refactor must preserve these rules and make ownership explicit.

- A small application-level Site–Survey coordinator owns workflows that span both features. It owns the transaction boundary and passes one opaque application transaction context through Site- and Survey-owned repository contracts; only infrastructure unwraps it as a Drizzle transaction. The `SiteSurveyModule` composition root binds the feature-owned repositories. Feature application code and controllers do not import peer infrastructure, and the modules have no circular dependency.

## Drizzle migration requirements

- Reuse the existing Drizzle schema and migration journal where appropriate; preserve the current migration ordering and runner behavior.
- Create one process-local PostgreSQL pool and pool-backed Drizzle provider per application entrypoint. The API composition root shares its provider across migrations, startup import, and Nest; the standalone importer CLI owns and closes its provider.
- Move raw SQL out of controllers and application use cases. A direct SQL statement is acceptable inside infrastructure when Drizzle's query builder is insufficient.
- Preserve transaction boundaries, `FOR UPDATE` behavior, advisory locking, PostGIS calculations, constraints, and error translation.
- Do not rewrite already-applied migrations as part of the refactor.
- Keep connection lifecycle and shutdown behavior explicit. The health endpoint retains a pool-level PostGIS connectivity check.

## Implementation sequence

1. Record the target layering and constraints in `DESIGN.md`; inspect the existing Nest, pool, Drizzle schema, and migration setup.
2. Establish the Drizzle provider and prove it with the AuthGuard's active-user/current-role lookup, without changing behavior.
3. Introduce feature Nest modules and move controller registration out of `AppModule`.
4. Refactor Sites: extract use cases, repository contracts, and Drizzle repositories; add HTTP DTOs and validation.
5. Refactor Surveys and define the Site–Survey collaboration seam while preserving per-Site transaction and lock behavior.
6. Refactor Auth into HTTP, application/domain, and infrastructure responsibilities; preserve active-user and role checks.
7. Keep Import application responsible for source parsing, reporting, and CLI orchestration. Keep Province and Species seed-only persistence in Import infrastructure; route Site and Survey writes through their owning application operations and the Site–Survey coordinator. Preserve the session advisory lock on one pinned connection and per-Survey transactions.
8. Move or remove the general `domain/` utilities according to ownership; keep only truly shared, framework-independent rules shared.
9. Review dependency direction, module exports, SQL placement, API contracts, migrations, and documentation before considering the refactor complete.

Each phase should be a small reviewable change. Do not combine this work with Step 6 feature implementation.

## Acceptance criteria

- [x] Backend remains one NestJS application, one independently managed backend package, and one PostgreSQL database.
- [x] `AppModule` composes platform and feature modules; feature modules own their controllers and providers.
- [x] Site, Survey, and Auth code has explicit `http`, `application`, `domain`, and `infrastructure` responsibilities, using the documented contract, use-case, DTO, and repository folders.
- [x] Domain code has no NestJS, HTTP, Drizzle, or `pg` dependencies.
- [x] The API and standalone CLI each have one explicit owner for their pool-backed Drizzle provider; API migrations, startup import, and Nest share the API provider, and shutdown closes it once.
- [x] Shared Site–Survey workflows use an application coordinator and one opaque transaction across repository contracts. `SiteSurveyModule` and Import CLI infrastructure may wire feature-owned repositories at their composition roots; feature application code and controllers do not import peer infrastructure, and no circular feature dependency exists.
- [x] The global `ValidationPipe` transforms only explicitly configured DTO values, rejects unknown fields, and maps failures to the current error envelope without changing parser/guard precedence.
- [x] AuthGuard's current active-user/role lookup uses Drizzle without changing authorization behavior.
- [x] Import parsing and reporting remain independent of HTTP DTOs; CLI operations use the Site–Survey coordinator and Survey application operations, while Import infrastructure may wire their repositories. The advisory lock, per-Survey transactions, and Province/Species seed handling remain intact.
- [x] Existing routes, API response contracts, role behavior, database constraints, migration history, spatial rules, and concurrency guarantees are preserved.
- [x] `DESIGN.md` documents module ownership, the Site–Survey seam, provider lifecycle, Drizzle/SQL usage, and material trade-offs.
- [x] Required backend build and existing tests pass; relevant HTTP validation and integration behavior is covered.

## Confirmed implementation decisions

- Use a global transforming, whitelisting `ValidationPipe`; explicitly transform query values, reject unknown fields, preserve body value types, and map validation errors to the existing envelope. Malformed JSON remains parser-first; guards run before DTO validation on parsed protected requests.
- Keep health checks at the pool level. First demonstrate Drizzle with the AuthGuard's active-user/current-role query.
- The API composition root owns one pool-backed Drizzle provider shared by migrations, startup import, and Nest. The standalone importer CLI owns and closes its own provider.
- Import owns file parsing, reporting, CLI orchestration, and Province/Species seed persistence. Site and Survey writes use their owning application operations and the Site–Survey coordinator; preserve the pinned-session advisory lock and per-Survey transactions.
- The Site–Survey coordinator owns shared transaction boundaries and passes one opaque application transaction context through module-owned repository contracts. The `SiteSurveyModule` composition root binds the Site and Survey repositories; Import infrastructure may compose the same public application operations for the CLI.

Capture architecture ownership, transaction and provider lifecycle rationale, and ValidationPipe/error-mapping trade-offs in `DESIGN.md` during implementation.

## Git instructions

Implement only this preparatory refactor; do not begin Step 6. Prefix every commit for this work with `refactor:`, not `step-N:`, because this refactor does not change Step numbering.
