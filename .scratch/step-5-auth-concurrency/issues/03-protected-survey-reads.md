# 03: Protected Survey reads

**What to build:** Signed-in viewer, editor, and admin users can inspect Survey pages and see who recorded each observation; anonymous or invalid callers cannot read Surveys. This establishes the authorization boundary reused by later protected writes.

**Blocked by:** 01: Login and development accounts.

**Status:** ready-for-agent

- [ ] `GET /sites/:code/surveys` accepts valid tokens for current active viewer, editor, and admin users; missing, malformed, invalid-signature, expired, disabled-user, or deleted-user tokens return `401 UNAUTHORIZED` in the shared error envelope.
- [ ] Resolve the user's current role on each protected request so role changes take effect immediately; reuse this boundary for later role-restricted routes. Authenticate and authorize parseable requests before Site lookup, including requests for nonexistent Sites.
- [ ] Each Survey list item includes `created_by` as the creator's user ID, or null for imported Surveys. Preserve ordering, pagination, Step 4 fields, and absence of password hashes or token secrets.
- [ ] Public Site reads, health, and Swagger remain public. Malformed JSON follows the parser-first shared `400` behavior; subsequent protected routes can reuse this authorization boundary without weakening error precedence.
- [ ] Generated OpenAPI and root README describe the implemented bearer requirement, permitted roles, Survey creator field, and authorization errors for the Survey list.
- [ ] Real HTTP/PostGIS tests cover each permitted role, expired/invalid tokens, disabling a user, unknown Site precedence, imported null creators, and the existing list contract. Adapt existing integration requests so the suite remains green; role-change effects are exercised on later admin-only routes.
