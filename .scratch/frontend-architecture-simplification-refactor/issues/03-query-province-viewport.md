# 03: Keep Province boundaries scoped to the map viewport

**What to build:** A visitor sees Province geometry update with the current map view without disturbing Site results. Move the Province viewport flow to the shared Query/Axios/Zod boundary and retire its parallel request controller.

**Blocked by:** 02: Keep viewport Site map and table synchronized. That ticket establishes settled-bounds wiring in the shared map workspace.

**Status:** resolved

- [x] Initial load and pan/zoom fetch only bounded Province GeoJSON; invalid bounds send no Province request.
- [x] Required Province properties and polygon coordinate shapes are validated; malformed or failed requests show an independent error and retry path.
- [x] Rapid map movements cannot display stale Province boundaries; loading and empty states remain distinct from Site results.
- [x] Province layer order, visibility, and interaction with Site selection remain unchanged in the isolated browser workflow.
- [x] Remove the redundant Province request controller and replace implementation-oriented tests with observable request and display coverage.

## Comments

- Implemented in `45fde6b`, merged in `3c3242e`. Combined frontend: 70 Vitest passed, typecheck/lint/build passed; disposable Compose browser: 8 passed, including bounded pan and Province visibility.
