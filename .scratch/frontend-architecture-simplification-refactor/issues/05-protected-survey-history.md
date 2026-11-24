# 05: Show session-safe paginated Survey history

**What to build:** A permitted user selects a Site and sees validated Survey history and points for that Site and session only. Use one infinite Query owner for pages, errors, and cancellation, and retire the unused imperative history controller.

**Blocked by:** 04: Sign in with one memory-only session and isolate protected data.

**Status:** ready-for-agent

- [ ] A viewer, editor, or admin loads Survey history only for a selected Site; unauthenticated and forbidden users do not see protected items or points.
- [ ] The shared Axios client sends the explicit token and validates Survey page fields, item coordinates, and pagination; malformed pages fail visibly without silent fallback.
- [ ] Query keys separate memory-only session epoch, Site code, and page size without including the JWT; old requests/results cannot cross accounts.
- [ ] Pages stay newest-first; duplicate Survey IDs appear once; partial coverage uses unique loaded count versus total, while next-page navigation follows response pagination.
- [ ] Survey points represent only unique loaded items. Load-more error/retry, 401 session invalidation, and 403 without logout retain their user-facing behavior.
- [ ] Replace the unused imperative request controller and its old implementation tests; move only production-used types/helpers and add focused Query/race and isolated-browser coverage.
