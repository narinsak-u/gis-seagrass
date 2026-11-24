# 07: Verify the complete frontend cutover

**What to build:** Users receive the same public and protected map workflows after every endpoint has moved to the agreed transport and state owners. Finish the cutover, documentation, and regression proof without starting Step 7.

**Blocked by:** 06: Simplify map layers and workspace without changing interaction.

**Status:** resolved

- [x] All consumed frontend API calls use the one Axios client with Zod response validation; remove obsolete Fetch transport, injection knobs, duplicate request controllers, stale exports, and implementation-only tests without losing observable coverage.
- [x] Current architecture and setup docs describe only implemented behavior and limitations; the accepted frontend ADR remains consistent with the final implementation.
- [x] Run frontend lint, typecheck, unit tests, build, and the existing disposable-Compose browser suite once for final integration; disclose any check that could not run or did not pass.
- [x] Check public bounded map/table/detail, authenticated Survey paging and point isolation, account-switch races, keyboard/mobile, basemap/attribution, and error/retry behavior end to end.
- [x] Review the final diff for secrets and unrequested backend, schema, gateway, nationwide data fetch, or Step 7 changes. Commit verified work with the agreed `refactor:` prefix; do not start Step 7.

## Comments

- Final integration: 69 Vitest tests passed; TypeScript, Oxlint, and production build passed. Disposable Compose browser suite passed 11/11, including 375px keyboard selection, stale viewport suppression, Site retry after 503, account switching, and Survey history. The browser run rebuilt the production frontend after the final source change.
- Two-axis code review resolved feature-owned Site parsing, inferred wire types, shared geometry schema, Query viewport cancellation, invalid-extent recovery, and Survey page consistency. Final diff contains no backend, schema, gateway, nationwide-fetch, or Step 7 changes; credential-like added lines are schema fields and test fixtures, not secrets.
