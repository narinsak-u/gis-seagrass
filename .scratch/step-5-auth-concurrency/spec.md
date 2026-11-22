Status: ready-for-agent

## Problem Statement

Site and Survey writes currently accept anonymous requests, while Survey reads cannot identify who recorded an observation. People cannot log in by role, Site status is not available in public Site reads, and a stale Site update does not return the current Site representation. Development accounts must be usable without exposing known credentials or signing secrets in deployments.

## Solution

Add short-lived JWT login and enforce the agreed viewer, editor, and admin permissions. Keep Site reads public and include current derived Site status. Add the creator's user ID to protected Survey lists, attribute API writes to the signed-in user, and give a stale Site PATCH the current Site Feature in a shared-error response. Seed development accounts only when explicitly enabled. Preserve existing spatial, validation, and transaction guarantees.

## User Stories

1. As a viewer, I want to log in with my email and password, so that I can read Surveys.
2. As an editor, I want to log in with my email and password, so that I can read Surveys under my assigned role.
3. As an admin, I want to log in with my email and password, so that I can manage Sites and Surveys.
4. As a caller, I want malformed login bodies rejected, so that login accepts only the agreed credential fields.
5. As a caller, I want an invalid email or password to produce the same error, so that accounts cannot be enumerated through login.
6. As a user, I want access tokens to expire within 15 minutes, so that a stolen token has a limited lifetime.
7. As a Site visitor, I want to view the map, Site list, and Site detail without logging in, so that public Site information remains accessible.
8. As a Site visitor, I want each Site list item to show Site status, so that I can compare monitored Sites.
9. As a map visitor, I want each Site GeoJSON feature to show Site status, so that the map can display current conditions.
10. As a Site visitor, I want Site detail to show Site status, so that I can see its current assessment.
11. As a Site visitor, I want a Site without Surveys to show `no_data`, so that absence of observations is not mistaken for poor cover.
12. As a Site visitor, I want Site status to reflect all Surveys from the latest observation date, so that older observations do not distort it.
13. As a viewer, I want to read Survey pages with each Survey's creator ID, so that I can identify who recorded an API observation.
14. As an editor, I want the same Survey read access as a viewer, so that I can inspect observations without editing them.
15. As an admin, I want to read Survey pages, so that I can inspect observations before changing them.
16. As a Survey reader, I want imported Surveys to show `created_by: null`, so that an absent human actor is represented honestly.
17. As an anonymous caller, I want protected routes to return `401 UNAUTHORIZED`, so that the access rule is predictable.
18. As a user, I want malformed, expired, or invalid-signature tokens rejected, so that only valid tokens grant access.
19. As a user, I want a token for a disabled or deleted account rejected, so that account removal takes effect immediately.
20. As a user, I want my current database role enforced on each request, so that role changes take effect without waiting for token expiry.
21. As a caller without the required role, I want `403 FORBIDDEN`, so that I can distinguish permission denial from missing authentication.
22. As a caller, I want authentication and authorization checked before protected resource lookup, so that nonexistent resources do not reveal their existence.
23. As a caller, I want malformed JSON to return the shared `400 VALIDATION_ERROR` envelope, so that parser errors remain understandable.
24. As an admin, I want to create a Site, so that I can register a monitored area.
25. As an admin, I want to update a Site name, so that its public description stays accurate.
26. As an admin, I want to update Site geometry, so that its boundary matches current knowledge without stranding Surveys.
27. As an admin, I want to soft-delete a Survey-free Site, so that it is no longer publicly listed.
28. As an editor, I want Site writes denied, including name and geometry changes, so that the read-only role cannot modify boundaries or labels.
29. As a viewer, I want Site writes denied, so that viewing access cannot change Sites.
30. As an admin, I want to create Surveys, so that new observations are recorded.
31. As an admin, I want to partially update Surveys, so that incorrect observations can be corrected.
32. As an admin, I want to hard-delete Surveys, so that the existing deletion contract remains available.
33. As a viewer or editor, I want Survey writes denied, so that only admins change observations.
34. As an admin, I want Site and Survey creation attributed to my account, so that the creator is recorded.
35. As an admin, I want Site and Survey updates attributed to my account and timestamped, so that the most recent actor is recorded.
36. As an admin, I want a species-only Survey PATCH attributed to me, so that changing associations is not invisible in the Survey audit fields.
37. As an admin, I want a Site soft delete attributed to me, so that the retained Site records its last actor.
38. As a data steward, I want `created_by` to remain unchanged after an update, so that the original actor is preserved.
39. As a data steward, I want client-supplied audit fields ignored or rejected, so that callers cannot impersonate another actor.
40. As an admin, I want a stale Site PATCH to return `409 VERSION_CONFLICT`, so that I know my version was superseded.
41. As an admin, I want the current Site GeoJSON Feature in `error.details.current`, so that I can reconcile a stale update.
42. As an admin, I want two concurrent Site PATCH requests using one version to produce exactly one success, so that version checks prevent lost updates.
43. As a developer, I want three usable development accounts seeded only when explicitly enabled, so that I can test each role without installing known accounts in deployments.
44. As a developer, I want restarts to preserve existing account credentials, roles, and inactive flags, so that seeding does not reset local changes.
45. As an operator, I want the API to refuse startup without a signing secret, so that it never issues tokens with an implicit key.
46. As an API consumer, I want login, authorization, and errors documented in Swagger, so that I can integrate against the actual contract.
47. As a developer, I want README instructions and development-only credentials, so that I can start and test the stack without using those credentials for deployment.

## Implementation Decisions

- `POST /auth/login` is public and accepts exactly `email` and `password` strings. Successful login returns an access token, `token_type: "Bearer"`, and `expires_in: 900`. Invalid credentials produce one generic `401 UNAUTHORIZED` response; malformed requests produce `400 VALIDATION_ERROR`.
- Sign JWT access tokens with a configured `JWT_SECRET` and a lifetime no greater than 15 minutes. Refuse startup when the secret is missing; no implicit key. Never return password hashes or the signing secret.
- Add `users.is_active` with a default of true for existing users. On each protected request, verify the Bearer token and resolve the current user and role from the database; reject invalid, expired, inactive, or deleted users with `401 UNAUTHORIZED`. Apply current-role changes on the next request.
- Seed one usable development account per viewer, editor, and admin role only behind an explicit development-account flag enabled in the development Compose setup. Insert only missing accounts; never reset existing passwords, roles, or inactive flags. Store salted password hashes, not plaintext. The API container's `NODE_ENV=production` does not control development seeding.
- Supply a clearly development-only example signing secret in example environment configuration. Document copying that configuration before Compose startup, the required signing secret, and the three local credentials in the root README. Deployments must replace the example secret and must not enable development account seeding.
- Keep existing health and Swagger routes public. Keep `GET /sites`, `GET /sites.geojson`, and `GET /sites/:code` public. Require viewer, editor, or admin for Survey list reads. Require admin for Site create, PATCH, and delete and for Survey create, PATCH, and delete. Editor is intentionally read-only in this Step.
- Authenticate and authorize parseable protected requests before business validation and resource lookup, including requests for nonexistent resources. The HTTP JSON parser may return `400 VALIDATION_ERROR` on malformed JSON before route authentication. Use the existing shared `{error:{code,message,details}}` envelope for all failures.
- Extend public Site list items and GeoJSON/detail feature properties with `siteStatus`. Derive it from all Surveys on the latest Survey date using the Step 4 thresholds; use `no_data` for Sites without Surveys. Do not store a status cache, add a status filter, or change Site PATCH success responses.
- Extend protected Survey list items with `created_by` as a user ID or null for imported observations. Preserve Step 4 write responses and public Survey fields otherwise; client request bodies cannot set actor or timestamp fields.
- Site and Survey records are the audit roots. On API inserts, set `created_by` and `updated_by` from the authenticated user and use server time for `updated_at`. Keep `created_by` immutable; update `updated_by` and `updated_at` on every successful update, including Survey species-only changes and Site soft deletion. Species associations inherit the parent Survey actor. Hard-deleted Surveys leave no durable actor history.
- Keep Site PATCH version checks and increment inside the transaction after authorization. Two concurrent requests with the same version yield exactly one success; the stale request receives `409 VERSION_CONFLICT` in the shared error envelope with the current Site GeoJSON Feature, matching the Site PATCH success shape, at `error.details.current`.
- Preserve the Step 3 and Step 4 validation, geography-distance, species-link transaction, active-Site, and concurrency contracts except for these explicit authorization, Site-status, and Survey creator additions.

## Testing Decisions

- Primary seam, confirmed by the user: send real HTTP requests through the NestJS app against an isolated disposable PostGIS database with real account records. Assert public responses, persisted records, and concurrency invariants, not private helper calls, mocked controllers, source text, or incidental wiring. Use a separate process-start check only for the required missing-secret failure.
- Reuse the existing API/PostGIS integration fixtures and Node test runner established for Site and Survey routes. Keep tests deterministic, isolated, and safe for the full suite; never run migrations or seed scripts against existing user or development data.
- Test login success and generic failure, request validation, JWT signature and expiry, maximum lifetime, inactive and deleted accounts, role changes, missing-secret startup, and development seeding enabled versus disabled and repeated startup.
- Exercise every Site and Survey route against anonymous, viewer, editor, and admin callers as applicable. Verify the public read exceptions, missing/invalid-token `401`, insufficient-role `403`, editor geometry denial, and authorization before lookup for missing resources and parseable invalid bodies; malformed JSON retains the shared `400` envelope.
- Assert `siteStatus` on Site list, GeoJSON, and detail reads with no Surveys and after create, update, and delete. Cover same-date averaging and earlier-date exclusion; keep write response shapes unchanged.
- Assert Survey list `created_by` for API-created versus imported observations and that responses never expose password hashes or secrets. Assert Site/Survey creator and updater fields and server timestamps on insert/update, Site soft delete, and species-only Survey PATCH; reject or ignore forged actor fields.
- Drive two concurrent authorized Site PATCH requests using the same version and assert one success, one `409 VERSION_CONFLICT`, unchanged spatial invariants, and the current Site Feature at `error.details.current`. Check unauthorized and forbidden requests cannot obtain the conflict representation.
- Inspect generated OpenAPI for login, bearer requirements, public routes, all role/error responses, Site-status and Survey-creator shapes, and the version-conflict envelope. Check README examples against the verified API; do not document production credentials.

## Out of Scope

- Refresh tokens, persistent token revocation lists, password reset, account-management endpoints, signup, and multi-factor authentication.
- Permission changes beyond the agreed matrix; editor has no write access in this Step.
- A durable audit-event log or actor history for hard-deleted Surveys; Survey-level versioning and optimistic locks.
- Frontend login or map UI, photo upload/editing, exports, and Step 6–9 features.
- Authentication for the seed importer; production secret management and hardening beyond the explicit signing-secret and development-seeding safeguards.

## Further Notes

- The agreed Step 5 implementation contract remains the authoritative source for requirements S5-01 through S5-10. Steps 1–4 are prerequisites; Step 5 implementation has not started.
- Existing Site and Survey tables already have nullable actor references and timestamps; the user table needs an active flag. Imported Surveys can legitimately lack a creator. Public Site status intentionally expands Step 3 read representations without changing the Site PATCH success response.
- The main spec was refined through confirmed decisions on version-conflict payload placement, audit scope, active-user checks, editor permissions, public Site status, development credential gating, and JSON parsing precedence.
- This publication contains a confirmed spec, not implementation tickets. Ticket creation and dependency ordering are separate issue-tracker work.
