# 05: Protected selected-Site Survey history and points

**What to build:** An authorized viewer, editor, or admin can inspect the selected Site's Survey pages and corresponding map locations; everyone else sees no protected Survey data.

**Blocked by:** 02: Synchronized Site table and filters; 04: Sign-in and current identity.

**Status:** ready-for-agent

- [ ] Only selecting a Site while signed in as viewer/editor/admin requests paginated `GET /sites/:code/surveys` with a Bearer token; anonymous visitors see a sign-in prompt.
- [ ] Survey points use real `lon`/`lat` values from loaded pages for the selected Site only. Paging visibly indicates when points cover only part of history; no fabricated or nationwide points appear.
- [ ] Site change, sign-out, or protected `401` clears Survey history and points immediately, without hiding public Site data; a protected `403` shows an access message and exposes no history.
- [ ] History has visible loading, retryable error, empty, and no-Survey-data states; controls are accessible by keyboard.
- [ ] Browser checks cover viewer/editor/admin access, anonymous access, stale selected-Site responses, pagination, and data clearance after auth failure or Site change.
