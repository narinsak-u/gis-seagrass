# 04: Sign in with one memory-only session and isolate protected data

**What to build:** A user signs in, changes accounts, or logs out without exposing a previous identity's Survey history. Replace the duplicate auth session/subscription owner with one Zustand session while keeping the public map usable.

**Blocked by:** 01: Load validated public Site details.

**Status:** resolved

- [x] Login and `/auth/me` use the shared Axios client and validated responses; `/auth/me` receives the fresh token explicitly before the session is published.
- [x] The token remains only in tab memory; reload starts anonymous; public Site and Province requests carry no Bearer token.
- [x] Logout, current-session 401, identity change, and direct account switch cancel and remove protected Survey queries and clear rendered points before exposing a replacement session.
- [x] An old request's late 401 or a late login/identity response cannot invalidate or restore a newer session; 403 preserves authentication.
- [x] Auth status, sign-in dialog, failure and retry behavior stay visible; focused deterministic tests cover the session/cache races against the currently running Survey flow.
- [x] Remove the parallel auth subscription controller without adding persistent storage or a replacement event manager.

## Comments

- Implemented in `57a4e53` and merged with Site viewport in `1efca6e`; combined Vitest: 71 passed, typecheck and lint passed; isolated browser: 7 passed. Integration smoke: 71 passed, typecheck and lint passed.
