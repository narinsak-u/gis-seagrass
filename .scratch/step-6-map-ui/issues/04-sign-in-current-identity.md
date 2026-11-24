# 04: Sign-in and current identity

**What to build:** A visitor can sign in, see the account's current email and role, and sign out without losing public Site browsing.

**Blocked by:** 01: Map and viewport Site browsing.

**Status:** resolved

- [x] Protected `GET /auth/me` (reusing Auth's route guard with `email` included in the active-actor lookup) returns `{email,role}` for the active token's current database user; missing, invalid, expired, deleted, or inactive-user tokens receive `401` in the shared error envelope, and role changes appear on the next request.
- [x] The workspace uses existing `POST /auth/login`, shows current email and role from `/auth/me`, and keeps the access token in tab memory only without storing credentials.
- [x] Sign-out and protected `401` clear session identity and token, return to sign-in, and preserve public map and Site browsing; login failure does not blank the map.
- [x] Login, sign-out, and identity controls are labeled and keyboard-operable; loading and recoverable error states are visible.
- [x] Existing auth HTTP integration patterns verify the endpoint and role/inactive transitions; browser checks verify login and continued public browsing after token rejection.
