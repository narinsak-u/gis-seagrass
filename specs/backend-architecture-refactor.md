# Backend Architecture Refactor

## Status

Ready for implementation. The implementation decisions below were confirmed during review.

## Goal

Refactor the NestJS backend into a modular monolith with pragmatic Clean Architecture layering. Keep one backend application and one PostgreSQL database. Organize code by business module, make dependency direction explicit, and use Drizzle ORM as the default data access tool.

The refactor must preserve the behavior and policies already established in Steps 1–5. It must not add product features or infer acceptance criteria for Steps 6–9.

## Scope

- Restructure Site, Survey, Auth, and import code into clear modules and layers.
- Move database access out of HTTP controllers and into infrastructure adapters.
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
│   ├── database/              # Drizzle client, schema, migration runner
│   ├── errors/                # Global HTTP error handling
│   └── health/                # Health endpoint
├── sites/
│   ├── sites.module.ts
│   ├── http/                  # Controllers, DTOs, guards, OpenAPI
│   ├── application/           # Use cases and required ports
│   ├── domain/                # Site concepts and business rules
│   └── infrastructure/       # Drizzle adapters and SQL
├── surveys/
│   ├── surveys.module.ts
│   ├── http/
│   ├── application/
│   ├── domain/
│   └── infrastructure/
├── auth/
│   ├── auth.module.ts
│   ├── http/
│   ├── application/
│   ├── domain/
│   └── infrastructure/
└── import/
    ├── parsers/               # Source format parsing and validation
    └── application/           # Import orchestration and CLI entry path
```

Names may be adjusted where the current implementation makes a better fit clear, but each business module must retain clear ownership of its HTTP, application, domain, and persistence behavior. Keep the import workflow usable as a CLI and avoid coupling it to HTTP DTOs.

## Architecture rules

1. **Dependency direction points inward.** HTTP code calls application use cases. Application code depends on domain rules and small ports it needs. Infrastructure implements those ports. Domain code must not import NestJS, Drizzle, `pg`, or HTTP types.
2. **Nest modules compose the application.** `AppModule` imports feature modules and platform modules. Each feature module registers its own controllers and providers and exports only what another module or the CLI needs.
3. **Use ports where a real seam exists.** Define ports for persistence or cross-module collaboration when they keep application code independent of infrastructure or clarify ownership. Do not add pass-through interfaces for every query.
4. **Modules own their data access.** A module must not reach into another module's tables or infrastructure adapter. Cross-module behavior goes through a deliberately small exported application interface or shared domain rule.
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

- A small application-level Site–Survey coordinator owns workflows that span both modules. It owns the transaction boundary and passes the same Drizzle transaction to Site- and Survey-owned persistence ports. Feature modules never access each other's tables or infrastructure directly; shared status and per-Site locking behavior use this coordinator without circular module dependencies.

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
4. Refactor Sites: extract use cases, ports, and Drizzle adapters; add HTTP DTOs and validation.
5. Refactor Surveys and define the Site–Survey collaboration seam while preserving per-Site transaction and lock behavior.
6. Refactor Auth into HTTP, application/domain, and infrastructure responsibilities; preserve active-user and role checks.
7. Keep Import application responsible for source parsing, reporting, and CLI orchestration. Keep Province and Species seed-only persistence in Import infrastructure; route Site and Survey writes through their owning application operations and the Site–Survey coordinator. Preserve the session advisory lock on one pinned connection and per-Survey transactions.
8. Move or remove the general `domain/` utilities according to ownership; keep only truly shared, framework-independent rules shared.
9. Review dependency direction, module exports, SQL placement, API contracts, migrations, and documentation before considering the refactor complete.

Each phase should be a small reviewable change. Do not combine this work with Step 6 feature implementation.

## Acceptance criteria

- [ ] Backend remains one NestJS application, one independently managed backend package, and one PostgreSQL database.
- [ ] `AppModule` composes platform and feature modules; feature modules own their controllers and providers.
- [ ] Site, Survey, and Auth code has explicit `http`, `application`, `domain`, and `infrastructure` responsibilities.
- [ ] Domain code has no NestJS, HTTP, Drizzle, or `pg` dependencies.
- [ ] The API and standalone CLI each have one explicit owner for their pool-backed Drizzle provider; API migrations, startup import, and Nest share the API provider, and shutdown closes it once.
- [ ] Shared Site–Survey workflows use an application-level coordinator and one Drizzle transaction across module-owned persistence ports, with no circular dependencies or direct cross-module data access.
- [ ] The global `ValidationPipe` transforms only explicitly configured DTO values, rejects unknown fields, and maps failures to the current error envelope without changing parser/guard precedence.
- [ ] AuthGuard's current active-user/role lookup demonstrates Drizzle access without changing authorization behavior.
- [ ] Import parsing and reporting remain independent of HTTP DTOs; CLI import operations delegate Site and Survey persistence to their owning application operations, retain the advisory lock and per-Survey transaction behavior, and preserve Province/Species seed handling.
- [ ] Existing routes, API response contracts, role behavior, database constraints, migration history, spatial rules, and concurrency guarantees are preserved.
- [ ] `DESIGN.md` documents module ownership, the Site–Survey seam, provider lifecycle, Drizzle/SQL usage, and material trade-offs.
- [ ] Required backend build and existing tests pass; relevant HTTP validation and integration behavior is covered.

## Confirmed implementation decisions

- Use a global transforming, whitelisting `ValidationPipe`; explicitly transform query values, reject unknown fields, preserve body value types, and map validation errors to the existing envelope. Malformed JSON remains parser-first; guards run before DTO validation on parsed protected requests.
- Keep health checks at the pool level. First demonstrate Drizzle with the AuthGuard's active-user/current-role query.
- The API composition root owns one pool-backed Drizzle provider shared by migrations, startup import, and Nest. The standalone importer CLI owns and closes its own provider.
- Import owns file parsing, reporting, CLI orchestration, and Province/Species seed persistence. Site and Survey writes use their owning application operations and the Site–Survey coordinator; preserve the pinned-session advisory lock and per-Survey transactions.
- The Site–Survey coordinator owns shared transaction boundaries and passes the same Drizzle transaction to module-owned persistence ports.

Capture architecture ownership, transaction and provider lifecycle rationale, and ValidationPipe/error-mapping trade-offs in `DESIGN.md` during implementation.

## Git instructions

Implement only this preparatory refactor; do not begin Step 6. Prefix every commit for this work with `refactor:`, not `step-N:`, because this refactor does not change Step numbering.
