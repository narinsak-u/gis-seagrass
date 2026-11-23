# Backend Architecture Refactor

Status: ready-for-agent

## Problem Statement

The Seagrass Monitoring backend has established Site, Survey, authentication, and import behavior, but its architecture makes that behavior harder to change safely. Nest controllers perform PostgreSQL queries directly, one application module registers every controller and provider, and import code combines source parsing with persistence. Cross-module Site–Survey invariants and database connection ownership are not represented by clear seams.

This preparatory refactor must make module ownership and dependency direction explicit without changing the behavior of Steps 1–5 or starting Step 6.

## Solution

Keep one NestJS backend and one PostgreSQL database. Organize the backend as a modular monolith with HTTP, application, domain, and infrastructure responsibilities for Site, Survey, and Auth. Keep request parsing and validation at the HTTP boundary, application use cases independent of transport, and database access in module-owned infrastructure.

Use Drizzle for ordinary database operations and its SQL/transaction support for PostGIS and locking. A small application-level Site–Survey coordinator owns workflows that span both modules and shares one transaction across their persistence ports. Preserve the existing API, spatial, import, migration, authorization, and concurrency contracts.

## User Stories

1. As a backend maintainer, I want Site, Survey, Auth, and Import responsibilities grouped by module, so that changes have clear ownership.
2. As a backend maintainer, I want each feature module to separate HTTP, application, domain, and infrastructure concerns, so that transport and persistence changes do not leak into business rules.
3. As a backend maintainer, I want domain rules independent of NestJS, HTTP, Drizzle, and `pg`, so that those rules remain testable without framework or database coupling.
4. As an API consumer, I want existing Site and Survey routes, response shapes, status codes, and error envelopes preserved, so that the refactor does not break clients.
5. As an API consumer, I want authorization and validation precedence preserved, so that protected resources remain inaccessible before authentication and role checks.
6. As a Site administrator, I want Site creation, updates, soft deletion, validation, and version conflicts to behave as before, so that reorganizing code does not change Site management.
7. As a Survey administrator, I want Survey creation, updates, hard deletion, species associations, and actor attribution to behave as before, so that existing Survey workflows remain reliable.
8. As a Site visitor, I want public Site status to continue reflecting current Surveys, so that the Site assessment stays accurate after the refactor.
9. As a Survey administrator, I want spatial distance checks and Site–Survey write serialization preserved, so that edits cannot strand Surveys or create invalid relationships.
10. As a Site administrator, I want optimistic locking and the current Site representation on a version conflict preserved, so that concurrent edits cannot silently overwrite one another.
11. As a user, I want authentication to resolve the current active account and role on each protected request, so that disabled accounts and role changes take effect immediately.
12. As a backend maintainer, I want ordinary reads and writes to use Drizzle, so that database access follows one default persistence approach.
13. As a backend maintainer, I want PostGIS queries, row locks, and other SQL-specific operations kept in infrastructure, so that necessary SQL remains explicit without leaking into controllers or domain rules.
14. As a backend maintainer, I want persistence ports only where they provide a real boundary, so that the design avoids pass-through abstractions.
15. As a backend maintainer, I want Site–Survey workflows coordinated through one application-level seam, so that both modules share a transaction without circular imports or direct access to each other's tables.
16. As an API operator, I want one explicit pool-backed Drizzle provider for API startup and request handling, so that migrations, startup import, and Nest share clear connection ownership.
17. As an operator, I want the health endpoint to retain its pool-level PostGIS check, so that health reporting does not depend on ORM query behavior.
18. As an importer operator, I want the standalone CLI to own and close its database provider, so that it remains usable without starting the HTTP application.
19. As a developer, I want HTTP DTOs to reject unknown fields and preserve existing validation errors, so that transport validation does not silently change the API contract.
20. As a developer, I want explicit query-value transformations and no implicit request-body coercion, so that inputs retain deliberate and predictable types.
21. As an API caller, I want malformed JSON rejected by the parser before route guards and parsed protected requests authorized before DTO validation, so that existing error precedence remains stable.
22. As an importer operator, I want source parsing, rejection reporting, and CLI orchestration kept separate from HTTP DTOs, so that import behavior remains independent of the API.
23. As an importer operator, I want Site and Survey writes delegated to their owning application operations, so that imports preserve the same module invariants as API writes.
24. As an importer operator, I want Province and Species seed persistence to remain owned by Import, so that seed-only data does not require unnecessary feature modules.
25. As an importer operator, I want the pinned-session advisory lock and per-Survey transactions preserved, so that concurrent imports remain serialized without making the entire import atomic.
26. As a developer, I want the existing Drizzle schema, migration history, and database constraints retained, so that deployed databases remain compatible.
27. As a developer, I want the refactor delivered in small reviewable phases, so that behavior changes are isolated from architecture changes.
28. As a project maintainer, I want module ownership, transaction boundaries, provider lifecycle, and Drizzle/SQL trade-offs documented, so that future maintainers can follow the architecture.
29. As a project maintainer, I want this preparatory work kept separate from Step 6, so that the architecture refactor does not expand into map features.

## Implementation Decisions

- Keep one NestJS application, one independently managed backend package, and one PostgreSQL database; do not introduce a monorepo or cross-application packages.
- `AppModule` composes platform and feature modules. Site, Survey, and Auth each own HTTP, application, domain, and infrastructure responsibilities. Export only application interfaces needed by other modules or the CLI.
- Dependencies point inward: HTTP calls application operations; application code depends on domain rules and small ports; infrastructure implements persistence ports. Domain code has no NestJS, HTTP, Drizzle, or `pg` dependencies.
- Use Drizzle for ordinary PostgreSQL reads and writes. Keep PostGIS functions, row locks, advisory-lock operations, and other query-builder gaps in infrastructure using Drizzle SQL support. Do not add generic repositories, CQRS, event buses, or an interface for every query.
- A small application-level Site–Survey coordinator owns workflows spanning both modules. It owns their transaction boundary and passes the same Drizzle transaction to Site- and Survey-owned persistence ports. Neither feature module accesses the other's tables or infrastructure directly.
- Create one pool-backed Drizzle provider per process entrypoint. The API composition root shares its provider across migrations, startup import, and Nest, then closes it once. The standalone importer CLI owns and closes its own provider. Keep health checks at the pool level.
- First demonstrate Drizzle with the AuthGuard's active-user/current-role lookup, preserving current authentication behavior.
- Define request DTOs in each owning module's HTTP layer. Configure one global `ValidationPipe` with transformation, whitelisting, and unknown-field rejection. Explicitly transform query values; do not implicitly coerce request-body values. Map validation errors to the current shared error envelope.
- Preserve malformed-JSON parser errors before guards and preserve guard-before-DTO-validation precedence for parsed protected requests. Keep domain validation and business invariants outside DTO classes.
- Keep Import responsible for source parsing, reporting, and CLI orchestration. Keep Province and Species seed-only persistence in Import infrastructure. Delegate Site and Survey writes to their owning application operations and the Site–Survey coordinator. Keep import parsing independent of HTTP DTOs.
- Preserve the importer-wide session advisory lock on one pinned connection and per-Survey transactions. Preserve rejection reporting and idempotency behavior.
- Reuse the existing schema and migration journal. Do not rewrite applied migrations or change database constraints or seed source data.
- Update `DESIGN.md` with module ownership, the Site–Survey seam, provider lifecycle, Drizzle/SQL usage, and material trade-offs.
- Use `refactor:` as the commit subject prefix for this preparatory work. Do not start Step 6.

## Testing Decisions

- Prefer the highest existing behavioral seam: real HTTP requests through the Nest application against a disposable PostGIS database. Assert API responses, persisted state, authorization order, and concurrency outcomes rather than private helper calls or internal wiring.
- Reuse the existing backend build and Node test suite, including Site, Survey, Auth, and importer HTTP/PostGIS integration coverage. Run database-backed tests only against a confirmed isolated, disposable PostGIS database.
- Keep the standalone importer testable through its CLI/application entry path. Verify parsing, idempotency, rejection reporting, advisory-lock serialization, and per-Survey rollback behavior using disposable database resources.
- Cover DTO validation through actual HTTP requests, including unknown fields, explicit query transformations, request-body types, shared error mapping, malformed JSON, and guard-before-validation precedence.
- Exercise the AuthGuard Drizzle pilot through protected HTTP routes. Verify current roles, disabled users, and authentication failures remain unchanged.
- Preserve existing tests for public Site status, Survey creator fields, spatial distance, species-link atomicity, soft deletion, version conflicts, and concurrent writes. Add tests only for behavior not already covered.
- Use the TypeScript build and review of module imports to verify dependency direction and framework-independent domain code. Do not add architecture-test infrastructure without a demonstrated need.

## Out of Scope

- Step 6 map UI or any Step 7–9 feature.
- Changes to API routes, response shapes, authorization policy, validation semantics, database constraints, spatial rules, or documented Site and Survey behavior.
- Replacing PostgreSQL, NestJS, Drizzle migrations, or the separate frontend/backend package setup.
- Microservices, a monorepo, generic repository frameworks, CQRS, event buses, or pass-through ports.
- Rewriting existing migrations or changing seed source data.
- Production secret management, deployment hardening, or new product features.

## Further Notes

This refactor is preparatory work before Step 6 and does not alter Step numbering. Implement the phases as small reviewable changes; do not combine them with Step 6. The current backend already has a Drizzle schema and migration journal, while HTTP controllers and importer operations still use `pg` directly. The agreed test seam is the existing real HTTP/PostGIS suite plus isolated importer CLI tests.