# Backend Architecture Simplification

Status: ready-for-agent

## Problem Statement

As a backend maintainer, I want the modular monolith to keep clear separation of concerns without extra wiring or repeated logic obscuring Site and Survey behavior. The current architecture already has feature modules and clean dependency direction, but database access is globally visible, the Site HTTP controller knows a PostgreSQL constraint, and Site read projections repeat mapping logic.

## Solution

Make a small, behavior-preserving cleanup to the existing backend architecture. Keep the current feature-first Clean Architecture and the Site–Survey workflow module. Make database dependencies visible in the Nest module graph without creating duplicate database providers, move PostgreSQL duplicate-code translation into the Site write path, consolidate repeated Site read projection, and keep the architecture check focused on meaningful dependency rules.

## User Stories

1. As a backend maintainer, I want each feature module to own its HTTP, application, domain, and infrastructure responsibilities, so that changes have a clear home.
2. As a backend maintainer, I want domain and application code to remain independent of NestJS and Drizzle, so that business behavior stays portable and testable.
3. As a backend maintainer, I want database dependencies visible in consuming Nest modules, so that module coupling is explicit rather than hidden by global provider visibility.
4. As an API operator, I want one pool-backed Drizzle provider per process entrypoint, so that migrations, startup import, and request handling share one lifecycle.
5. As a Site administrator, I want duplicate Site codes to retain the existing `DUPLICATE_CODE` response, so that moving database error handling does not change client behavior.
6. As a backend maintainer, I want PostgreSQL constraint details handled inside the Site write path, so that HTTP code depends on application meaning rather than storage details.
7. As a Site visitor, I want list and GeoJSON reads to map Site fields and Site status consistently, so that the same Site has consistent response properties.
8. As a backend maintainer, I want repeated Site response projection implemented once, so that changes to the public Site summary have one place to update.
9. As a backend maintainer, I want Site–Survey workflows to retain one transaction seam, so that concurrent Site and Survey writes preserve their invariants.
10. As a backend maintainer, I want cross-module imports constrained to public exports and documented composition roots, so that private adapters do not become accidental dependencies.
11. As a backend maintainer, I want architecture checks to enforce dependency direction rather than incidental folder trivia, so that useful structural constraints remain easy to understand.
12. As an API consumer, I want routes, response bodies, status codes, error envelopes, validation, and authorization behavior unchanged, so that this refactor does not require client changes.
13. As a backend maintainer, I want no new contract for every class or operation, so that Clean Architecture does not create pass-through abstractions without a real seam.
14. As an importer operator, I want the standalone Import CLI and its use of the same Site and Survey operations preserved, so that API architecture changes do not break imports.
15. As a maintainer, I want the cleanup delivered as a small refactor, so that its behavior and module changes are easy to review.

## Implementation Decisions

- Keep one NestJS application, one backend package, and one PostgreSQL database.
- Preserve the feature-first physical layers and module ownership recorded in ADR 0001. Keep application and domain code independent of NestJS, HTTP, Drizzle, and `pg`.
- Preserve `SiteSurveyModule` as the composition root for Site–Survey workflows. Keep the opaque transaction context, shared transaction behavior, and feature-owned repository adapters. Do not split or replace this module.
- Replace global database visibility with explicit database imports for modules that own Drizzle adapters. Keep the application composition root responsible for creating the single configured provider. Do not create additional pools or change provider lifecycle. Keep database, health, and global error-filter ownership in Platform.
- Move recognition of PostgreSQL unique-constraint failure for Site code into the Site write path. Translate it to the existing application error code `DUPLICATE_CODE`; retain the existing HTTP status, error envelope, and message contract.
- Consolidate the repeated Site-to-public-summary mapping used by list and GeoJSON reads inside the existing Site query implementation. Keep distinct retrieval behavior and detail fields such as latest Survey summary.
- Keep the architecture check dependency-focused. It must reject forbidden inward-to-outward imports and private cross-module adapter imports, while permitting only documented composition roots. Do not add rules that merely constrain harmless naming or file trivia.
- Do not introduce a new architecture framework, generic repository base, CQRS, event bus, or additional abstraction solely to reduce line count.
- Do not change schema, migrations, route contracts, spatial rules, authorization policy, transaction ordering, import semantics, or public domain terms.

## Testing Decisions

- Use the highest existing behavioral seam: real HTTP requests through the Nest application against the disposable PostGIS test database.
- Verify Site creation with a duplicate code still returns the current `DUPLICATE_CODE` status and error envelope. Keep the existing checks for reserved codes and Site lifecycle behavior.
- Verify list and GeoJSON responses retain the same Site fields and status values after projection consolidation.
- Boot the real Nest application through the existing integration tests to exercise explicit database module wiring and prove that all consumers use the same configured provider.
- Extend the existing architecture check to cover explicit database imports and restrict private infrastructure imports to approved composition roots. Assert dependency rules, not source text or implementation details.
- Keep the full existing Site, Survey, Auth, and Import tests as compatibility coverage. Do not add a separate test harness or test private provider wiring directly.
- Good tests assert observable HTTP responses, persisted state, and preserved module dependency rules. They must not assert helper calls, private mapping functions, provider registration arrays, or incidental implementation structure.
- Prior art: Site HTTP/PostGIS integration tests already verify duplicate-code responses, Site reads, lifecycle behavior, and API contracts. The backend architecture test already checks physical module and import rules.
- Run the backend build and test command once against a confirmed disposable PostGIS database after implementation.

## Out of Scope

- Replacing or broadly restructuring the existing Clean Architecture layers.
- Changing public Site or Survey behavior, routes, validation, authorization, error contracts, spatial calculations, concurrency, or transactions.
- Rewriting Site–Survey coordination or moving its business rules into controllers or repositories.
- Schema changes, migrations, new domain concepts, or glossary changes.
- Reworking the Import CLI or changing importer reporting and transaction behavior.
- Adding abstractions for every controller, use case, query, or repository method.
- Introducing microservices, a monorepo, CQRS, event-driven messaging, or a new testing framework.
- Starting a new product feature or changing Step scope.

## Further Notes

The existing physical-layer refactor and ADR 0001 are implemented. This spec is a follow-up simplification, not a replacement for that architecture. The agreed test seam is the existing Nest HTTP/PostGIS integration suite, with the existing architecture check guarding dependency direction.