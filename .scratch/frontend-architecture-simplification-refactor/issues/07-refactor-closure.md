# 07: Verify the complete frontend cutover

**What to build:** Users receive the same public and protected map workflows after every endpoint has moved to the agreed transport and state owners. Finish the cutover, documentation, and regression proof without starting Step 7.

**Blocked by:** 06: Simplify map layers and workspace without changing interaction.

**Status:** in-progress

- [ ] All consumed frontend API calls use the one Axios client with Zod response validation; remove obsolete Fetch transport, injection knobs, duplicate request controllers, stale exports, and implementation-only tests without losing observable coverage.
- [ ] Current architecture and setup docs describe only implemented behavior and limitations; the accepted frontend ADR remains consistent with the final implementation.
- [ ] Run frontend lint, typecheck, unit tests, build, and the existing disposable-Compose browser suite once for final integration; disclose any check that could not run or did not pass.
- [ ] Check public bounded map/table/detail, authenticated Survey paging and point isolation, account-switch races, keyboard/mobile, basemap/attribution, and error/retry behavior end to end.
- [ ] Review the final diff for secrets and unrequested backend, schema, gateway, nationwide data fetch, or Step 7 changes. Commit verified work with the agreed `refactor:` prefix; do not start Step 7.
