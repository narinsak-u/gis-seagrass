# 06: Simplify map layers and workspace without changing interaction

**What to build:** A visitor keeps the same map selection, status meaning, Survey points, and responsive workspace while maintainers have fewer mixed responsibilities in map lifecycle and UI orchestration. Extract only cohesive layer/event logic; do not introduce another state owner.

**Blocked by:** 03: Keep Province boundaries scoped to the map viewport; 05: Show session-safe paginated Survey history.

**Status:** resolved

- [x] One MapLibre map instance retains one basemap, attribution, correct Province/Site/Survey layer order, five Site status colors, selection highlighting, popups, and fitBounds behavior.
- [x] Updating data or unmounting does not duplicate sources, layers, listeners, or popups; cleanup is symmetric and verifiable.
- [x] Table row and polygon clicks agree on selected Site and detail; loaded Survey points remain correct after selection, map movement, and logout.
- [x] Loading/empty/error/retry controls, table keyboard operations, and 375px layout keep working in the isolated browser workflow.
- [x] Workspace composition is simpler without copying Query results into Zustand, adding generic layers, or splitting components solely to increase file count.

## Comments

- Implemented in `c4af908`, merged in `e67e239`. Map-layer ordering test and 70 Vitest passed; typecheck/lint/build and desktop disposable Compose browser 8 passed. Final closure E2E-09 passed 375px keyboard selection; complete browser suite 9/9 passed.
