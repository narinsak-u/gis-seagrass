# 05: Enforce flat layers in architecture guard and update active docs

**What to build:** Backend contributors receive an automatic test failure if anyone reintroduces retired nested subfolders or violates flat Clean Architecture layer boundaries, and active architecture documentation clearly reflects ADR-0002's flattened layout without rewriting historical specs.

**Blocked by:** 02: Flatten and rename Sites layers; 03: Flatten and rename Surveys layers; 04: Flatten and rename Auth, Site–Survey workflows, and Import layers

**Status:** resolved

- [x] The static architecture check requires `domain`, `application`, `infrastructure`, and `presentation` on HTTP features (and the approved layers on Site–Survey workflows and Import) and forbids reintroducing retired nested folders (`http`, `dto`, `contracts`, `use-cases`, `repositories`, `transactions`, `security`) inside flattened feature layers without hardcoding optional filenames or blocking legitimate future subfolders.
- [x] The static architecture check blocks both `presentation` and `http` imports (alongside `infrastructure`, NestJS, Express, Drizzle, `pg`, and platform database code) from domain and application layers, enforces the flattened cross-module Drizzle transaction adapter path, and preserves all public-barrel, composition-root, and single database-module checks.
- [x] Active architecture documentation (the project design document and specs roadmap) reflects the flattened four-layer layout and role-based naming conventions, and ADR-0001 plus the two completed historical architecture specs carry brief supersession pointers referencing ADR-0002 without altering historical acceptance evidence.
- [x] Full backend build and complete existing test suite pass against isolated disposable PostGIS, with zero behavioral, schema, migration, seed, or Step 6 changes, and two-axis code review (Standards & Spec) passed with review cleanups applied.

## Comments

- Resolved on `refactor/backend-clean-architecture-naming` via commits `b038747` and `524ffe1`. Verified with full backend build, two-axis code review, and 78/78 disposable PostGIS tests (0 failed, 0 skipped).
