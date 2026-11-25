# 05: Show session-safe paginated Survey history

**What to build:** A permitted user selects a Site and sees validated Survey history and points for that Site and session only. Use one infinite Query owner for pages, errors, and cancellation, and retire the unused imperative history controller.

**Blocked by:** 04: Sign in with one memory-only session and isolate protected data.

**Status:** resolved

- [x] A viewer, editor, or admin loads Survey history only for a selected Site; unauthenticated and forbidden users do not see protected items or points.
- [x] The shared Axios client sends the explicit token and validates Survey page fields, item coordinates, and pagination; malformed pages fail visibly without silent fallback.
- [x] Query keys separate memory-only session epoch, Site code, and page size without including the JWT; old requests/results cannot cross accounts.
- [x] Pages stay newest-first; duplicate Survey IDs appear once; partial coverage uses unique loaded count versus total, while next-page navigation follows response pagination.
- [x] Survey points represent only unique loaded items. Load-more error/retry, 401 session invalidation, and 403 without logout retain their user-facing behavior.
- [x] Replace the unused imperative request controller and its old implementation tests; move only production-used types/helpers and add focused Query/race and isolated-browser coverage.

## Comments

- Implemented in `3531b5c`, merged in `4201316`; corrected live Survey wire pagination (`items`, `total`, `page`) in `1291e8f`. Combined frontend: 70 Vitest passed, typecheck/lint/build passed; disposable Compose browser: 8 passed, including account-switch isolation and Survey readback.
