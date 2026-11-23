# 06: Enforce and document physical layer rules

**What to build:** Backend contributors receive an automatic test failure when production files or imports violate the agreed module structure.

**Blocked by:** 01: Move platform and shared foundations; 02: Restructure Auth and route guard lookups through application; 03: Restructure Sites into physical layers; 04: Restructure Surveys and Site–Survey coordination; 05: Restructure Import while preserving the standalone CLI.

**Status:** resolved

- [x] A TypeScript-based check validates production file placement and the approved dependency matrix, allowing concrete cross-feature repository imports only from `SiteSurveyModule` and Import CLI composition; tests remain outside production layers.
- [x] The check runs as part of the backend test command without adding a dependency.
- [x] `DESIGN.md` records ownership, allowed imports, public module exports, the opaque transaction seam, provider lifecycle, and trade-offs.
- [x] Full backend build and tests pass against disposable PostGIS; no schema, migration, seed, API, or Step 6 behavior changes.
