# Backend Physical Layer Refactor

## Status

Ready for implementation. Decisions were confirmed during design review.

## Problem Statement

The backend has feature modules and persistence adapters, but its physical structure does not express the agreed modular monolith. Controllers, request DTOs, and application use cases remain at feature roots; database, health, and error handling sit outside a platform module; and shared rules are collected in a root `domain` directory. The AuthGuard and Site–Survey transaction seam also expose database details across layers.

## Solution

Restructure backend production code into explicit physical modules and Clean Architecture layers. Keep one NestJS application, one backend package, one PostgreSQL database, and the current public behavior. Make layer placement and dependency direction enforceable by an architecture check.

## User Stories

1. As a backend maintainer, I want each feature's HTTP, application, domain, and infrastructure code in explicit folders, so that ownership is visible from the tree.
2. As a backend maintainer, I want application use cases free of NestJS and database types, so that business workflows remain independent of adapters.
3. As a backend maintainer, I want domain rules free of HTTP, NestJS, Drizzle, and `pg`, so that business rules remain portable and testable.
4. As an API consumer, I want all existing routes, response bodies, status codes, error envelopes, and authorization rules preserved, so that the structural refactor does not break clients.
5. As an API operator, I want database, health, and global error handling owned by a platform module, so that shared technical concerns have one home.
6. As a user of a protected route, I want the AuthGuard to resolve the current active account and role through an application interface, so that authorization behavior stays current without HTTP code querying the database.
7. As a Site administrator, I want Site creation, reading, editing, deletion, and conflict handling to continue through the same rules, so that moving code does not alter Site behavior.
8. As a Survey administrator, I want Survey reads and writes to retain the same authorization, validation, attribution, and spatial rules, so that the refactor preserves Survey behavior.
9. As a Site visitor, I want Site status to continue deriving from current Surveys, so that status remains accurate without introducing a cache.
10. As a backend maintainer, I want Site–Survey workflows to share one transaction through an opaque application context, so that the application layer does not depend on Drizzle transaction types.
11. As an importer operator, I want CLI parsing, orchestration, Province/Species persistence, and reports to remain independent of HTTP DTOs and Nest startup, so that the standalone importer remains usable.
12. As an importer operator, I want Site and Survey imports to use their owning application operations, so that imports preserve the same invariants as API writes.
13. As a backend maintainer, I want Drizzle repositories and SQL in infrastructure adapters, so that database details stay at the outer layer.
14. As a backend maintainer, I want only real persistence and collaboration seams to have ports, so that the refactor avoids pass-through abstractions.
15. As a project maintainer, I want an automated architecture check, so that file placement and dependency rules cannot silently regress.
16. As a project maintainer, I want the architecture decision and trade-offs recorded, so that future changes preserve the intended module relationships.

## Implementation Decisions

- Keep `app.module.ts` and `main.ts` as the composition root. Add a `PlatformModule` for database provider, health endpoint, and global HTTP error mapping.
- Give Sites, Surveys, and Auth a Nest module plus physical `http`, `application`, `domain`, and `infrastructure` layers. Keep controllers, DTOs, guards, and OpenAPI in `http`; use cases and their required ports in `application`; business rules and types in `domain`; concrete Drizzle repositories/adapters and SQL in `infrastructure`.
- Keep application classes plain TypeScript. Nest provider factories compose application use cases and infrastructure adapters. The HTTP layer calls application interfaces and does not query persistence directly.
- Move active-user and current-role lookup behind an Auth application port implemented by a Drizzle adapter. The AuthGuard preserves per-request status and role checks.
- Keep Site–Survey coordination in a dedicated application module and composition root. It owns cross-feature workflows and transaction sequencing, and binds feature-owned persistence adapters to application ports. Avoid separate Nest infrastructure modules used only for provider registration.
- Define an opaque Site–Survey transaction context and transaction-runner port. A Drizzle infrastructure adapter opens one transaction and passes the context through feature-owned ports; only infrastructure unwraps the Drizzle transaction.
- Put the plain shared application-error contract outside `domain`; `PlatformModule` maps its stable codes to existing HTTP statuses and envelopes.
- Put Site status and geometry policies with Site ownership; put Survey date rules with Survey ownership. Keep shared WGS84 geometry rules in a narrow geospatial domain module and generic object-shape checks in shared input parsing. Expose cross-module rules through explicit public exports, not private deep imports.
- Keep Import as a standalone CLI module with parser, application, and infrastructure layers. It does not become a Nest feature module or depend on HTTP DTOs. It calls Sites and Surveys through their public application operations.
- Keep the per-process Drizzle provider lifecycle, pinned importer advisory lock, per-Survey transactions, migration ordering, database constraints, source data, and API behavior unchanged.
- Keep tests at their owning module roots. Add a TypeScript-based architecture check to the backend test command; it checks production file placement and the approved import matrix without a new package.
- Update `DESIGN.md` with physical ownership, allowed dependencies, public module exports, opaque transaction context, provider lifecycle, and material trade-offs.

## Testing Decisions

- Test user-visible behavior through existing real HTTP requests against a disposable PostGIS database. Do not add implementation-coupled tests for provider wiring or private helpers.
- Reuse existing Site, Survey, Auth, and importer integration tests for routes, response contracts, roles, validation precedence, spatial rules, concurrency, reporting, and CLI behavior.
- Add one static architecture check using the installed TypeScript compiler API. It verifies one root Nest module per Sites and Surveys feature, rejects infrastructure-only Nest modules, checks approved composition-root adapter imports, and ensures application/domain files do not import NestJS, HTTP, Drizzle, or `pg`.
- Run the TypeScript build and full backend suite against a confirmed disposable PostGIS container with no shared volume.
- Prior art: backend Node test suite already runs real Nest HTTP and importer tests against `IMPORT_TEST_DATABASE_URL`.

## Acceptance Criteria

- [ ] `platform` owns database, health, and global error handling; `AppModule` composes platform and feature modules.
- [ ] `sites`, `surveys`, and `auth` each have a module file and physical `http`, `application`, `domain`, and `infrastructure` directories.
- [ ] Import has physical parser, application, and infrastructure responsibilities and remains runnable as a standalone CLI without Nest.
- [ ] No production source remains in the catch-all root `domain` directory.
- [ ] Application and domain code import no NestJS, HTTP, Drizzle, or `pg` symbols.
- [ ] HTTP controllers and guards access persistence only through application interfaces; AuthGuard still resolves active users and current roles on every protected request.
- [ ] Drizzle repositories, SQL, and database-provider details stay in platform or feature infrastructure.
- [ ] The Site–Survey coordinator shares one opaque transaction context across module-owned persistence ports, with no circular feature-module dependency.
- [ ] Shared rules and application errors live in explicit shared ownership areas and cross-module imports use public exports.
- [ ] The architecture check fails on forbidden file placement or dependency direction and runs as part of backend tests.
- [ ] Existing API, database, migration, spatial, authorization, import, and concurrency behavior remains unchanged.
- [ ] `DESIGN.md` documents the final physical structure and trade-offs.
- [ ] Backend build and full existing tests pass against disposable PostGIS; no Step 6 behavior is added.

## Out of Scope

- New Site, Survey, Auth, Import, or frontend features.
- Changes to API routes, response contracts, status policy, database schema, migrations, seed data, or authorization policy.
- Replacing PostgreSQL, NestJS, Drizzle, or the separate frontend/backend packages.
- Microservices, a monorepo, generic repository bases, CQRS, event buses, or a port for every query.
- Production deployment or security-hardening work.

## Further Notes

This is a follow-up to the earlier backend architecture refactor. It makes the physical layout and dependency rules mandatory, rather than accepting semantic layering at feature roots. Use `refactor:` for every commit; do not change Step numbering or begin Step 6.
