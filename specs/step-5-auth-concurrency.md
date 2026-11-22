# Step 5 — Authentication, Authorization, and Concurrency

**Project phase:** Step 5 — Authentication, Authorization, and Concurrency. **Prerequisite:** Steps 1–4 completed and committed. **Commit prefix:** `step-5:`. **Status:** Agreed specification; ready for ticketing. Implementation has not started.

## Objective

Add short-lived JWT authentication and role-based access control to the Site and Survey APIs. Keep map and Site-status reads public, restrict protected operations by role, record the acting user on writes, and preserve the Site version conflict guarantee under concurrent PATCH requests.

## API contract

`POST /auth/login` is the only authentication route and does not require a token. It accepts a JSON object with exactly `email` and `password` strings (the user table identifies accounts by email). All other Site and Survey routes follow the public/protected policy below; existing health and Swagger routes stay public. Protected routes authenticate and authorize the caller before business validation or resource lookup. A missing or invalid token returns `401 UNAUTHORIZED` even for a nonexistent resource; an authenticated caller lacking the required role receives `403 FORBIDDEN` before resource lookup. Malformed JSON is rejected by the HTTP body parser with `400 VALIDATION_ERROR` before route authentication; this does not disclose whether a resource exists. The editor role is intentionally read-only in this Step.

JWT access tokens expire no later than 15 minutes after issuance. Protected requests send the token as `Authorization: Bearer <token>`. Authentication and authorization errors use the shared Step 3 envelope: `{"error":{"code":"UNAUTHORIZED","message":"Authentication required","details":{}}}` or `{"error":{"code":"FORBIDDEN","message":"Insufficient permissions","details":{}}}`. Login failure returns `401 UNAUTHORIZED` without revealing whether the email or password was incorrect.

| Method and path | Access | Success | Error cases |
| --- | --- | --- | --- |
| `POST /auth/login` | Public | `200 {"access_token":"<JWT>","token_type":"Bearer","expires_in":900}` for valid credentials | `400 VALIDATION_ERROR`; `401 UNAUTHORIZED` for invalid credentials |
| Existing Site map/list/status reads (`GET /sites`, `GET /sites.geojson`, `GET /sites/:code`) | Public | Existing Step 3 response plus derived `siteStatus`: on list items, GeoJSON feature properties, and detail feature properties | Existing Step 3 errors |
| `POST /sites`, `PATCH /sites/:code` name-only | Admin | Existing Step 3 response | `401 UNAUTHORIZED`; `403 FORBIDDEN`; existing Step 3 errors |
| `PATCH /sites/:code` containing `geometry` | Admin | Existing Step 3 response | `401 UNAUTHORIZED`; `403 FORBIDDEN`; existing Step 3 errors |
| `DELETE /sites/:code` | Admin | Existing Step 3 response | `401 UNAUTHORIZED`; `403 FORBIDDEN`; existing Step 3 errors |
| `GET /sites/:code/surveys` | Viewer, editor, admin | Existing Step 4 page response; each item includes nullable `created_by` as a user ID (imported Surveys may have no actor) | `401 UNAUTHORIZED`; `403 FORBIDDEN`; existing Step 4 errors |
| `POST /sites/:code/surveys`, `PATCH /surveys/:id`, `DELETE /surveys/:id` | Admin | Existing Step 4 response | `401 UNAUTHORIZED`; `403 FORBIDDEN`; existing Step 4 errors |

For Site PATCH, authorization is based on the fields in the request: admin may change `name` and/or `geometry`; editor and viewer are forbidden from changing either. An editor request containing geometry receives `403 FORBIDDEN` even if it also contains an otherwise permitted field. Existing validation and version-conflict behavior applies after authorization.

`siteStatus` is the Step 4 latest-survey-date mean-cover classification (`very_good`, `good`, `fair`, `poor`, or `no_data`). Add it to every public Site list item, each `GET /sites.geojson` feature's `properties`, and the `GET /sites/:code` feature's `properties`. Derive it from current Surveys, including `no_data` for Sites without Surveys; do not add a status filter or change the Site PATCH success shape.

## Authorization matrix

| Action | Public (no login) | Viewer | Editor | Admin |
| --- | --- | --- | --- | --- |
| View map, Site list, and Site status | Yes | Yes | Yes | Yes |
| Read Survey records, including `created_by` | No | Yes | Yes | Yes |
| Create, update, or delete Surveys | No | No | No | Yes |
| Change a Site name | No | No | No | Yes |
| Create or delete a Site | No | No | No | Yes |
| Change Site geometry | No | No | No | Yes |

## Requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S5-01 | Implement `POST /auth/login` and issue signed JWT access tokens with a maximum lifetime of 15 minutes | REQUIRED |
| S5-02 | Seed test accounts for the viewer, editor, and admin roles only when explicitly enabled for development; document their usable development credentials in the root README when implementation is complete | REQUIRED; project deliverable |
| S5-03 | Keep Site map/list/status reads public, add derived `siteStatus` to Site read representations, and enforce the authorization matrix on every Site and Survey route | REQUIRED |
| S5-04 | Authenticate and authorize protected requests before resource lookup; missing/invalid credentials return `401`, and insufficient role returns `403`, regardless of resource existence | REQUIRED |
| S5-05 | Deny editor geometry changes on `PATCH /sites/:code` with `403 FORBIDDEN` | REQUIRED |
| S5-06 | Include `created_by` in Survey read representations for viewer, editor, and admin; do not expose password hashes or token secrets | REQUIRED |
| S5-07 | Record `created_by`, `updated_by`, and `updated_at` on Site and Survey records changed through the API; derive actor fields from the authenticated identity, never from client input. Species associations inherit the Survey's actor; hard deletes do not retain an actor history | REQUIRED |
| S5-08 | Preserve Site PATCH optimistic locking: require the version read by the client, atomically compare it with the stored version, and increment it on success | REQUIRED; Step 3 contract |
| S5-09 | For two concurrent PATCH requests using the same version, exactly one succeeds and the other returns `409 VERSION_CONFLICT` with the current Site representation | REQUIRED |
| S5-10 | Return all errors in the shared `{error:{code,message,details}}` envelope and document the login and authorization behavior in `/docs` and the root README | REQUIRED; Step 3 convention |

## Authentication and persistence behavior

- Store only password hashes for seeded accounts. Never return password hashes or signing secrets from an API. Require a configured `JWT_SECRET` at startup; never silently use a hard-coded fallback. Supply a clearly development-only example value in `.env.example` and require deployment-specific secrets.
- Seed three usable development accounts, one for each role: `viewer`, `editor`, and `admin`, only when an explicit development-account flag is enabled in the development Compose configuration. Seed only missing accounts; never overwrite existing credentials, roles, or inactive flags on restart. The backend container sets `NODE_ENV=production` even under development Compose, so do not infer seeding from `NODE_ENV`. Keep credentials in the root README for local development only; document copying `.env.example` to `.env` and configuring the required signing secret before Compose startup. Deployments must not enable development seeding or use the documented example signing secret.
- Add `users.is_active`, defaulting to true for existing users. A valid token identifies an existing active user; look up that user and current role on every protected request. Reject missing, malformed, expired, invalid-signature, inactive-user, deleted-user, or otherwise invalid tokens with `401 UNAUTHORIZED`. Role changes take effect on the next request.
- Ignore or reject client-supplied audit fields (`created_by`, `updated_by`, `updated_at`); the server sets Site and Survey actor fields from the authenticated actor and current time. Set both actor fields on insert; `created_by` never changes later. `updated_by` and `updated_at` change on each successful update, including a species-only Survey PATCH and a Site soft delete. Species links are part of the Survey record for audit purposes; a hard-deleted Survey leaves no durable actor history.
- Use a transaction for a Site PATCH that checks the supplied version and writes the change. A stale version returns `409 VERSION_CONFLICT` in the shared error envelope, with the current Site GeoJSON Feature (the Site PATCH success representation) at `error.details.current`. Do not return a conflict for an authorized request until after authorization has passed.
- Maintain the Step 3 and Step 4 response and validation contracts except for the explicitly added Survey `created_by`, public Site `siteStatus`, and authorization behavior in this specification.

## Tests and verification

- Login tests cover valid credentials, invalid credentials, inactive accounts, token signature/expiry validation, the 15-minute maximum lifetime, required signing-secret configuration, and development-account seeding only when explicitly enabled.
- Authorization tests cover every row of the matrix across all Site and Survey routes, including public Site status before and after Survey changes, `no_data` without Surveys, editor read-only access, and forbidden writes.
- Ordering tests prove missing/invalid token returns `401` and insufficient role returns `403` before business validation and lookup for parseable requests, including requests for nonexistent resources. Malformed JSON returns the shared `400` envelope before route authentication. Verify editor geometry PATCH returns `403` and disabling a user invalidates an issued token.
- Audit tests verify Site and Survey actor and timestamp values on create/update (including species-only updates and Site soft delete), immutability of `created_by`, nullable imported Survey `created_by`, and rejection/ignoring of client-supplied audit fields.
- Concurrent integration test sends two Site PATCH requests with the same version; exactly one succeeds and the other returns `409 VERSION_CONFLICT` with the current Site GeoJSON Feature in `error.details.current`.
- OpenAPI and root README document login, bearer authentication, roles, and the three development accounts. Do not publish credentials intended for non-development use.

## Definition of done

- [ ] Login issues valid JWTs that expire within 15 minutes; invalid credentials fail without disclosing which credential was wrong.
- [ ] Public Site list, GeoJSON, and detail reads expose the current derived `siteStatus`, including `no_data` without Surveys.
- [ ] The authorization matrix is enforced on every Site and Survey route.
- [ ] Authentication and role checks happen before resource lookup on protected routes.
- [ ] Survey reads expose `created_by` to viewer, editor, and admin callers.
- [ ] API mutations set audit fields from the authenticated user and server clock.
- [ ] Two concurrent Site PATCH requests using one version result in one success and one `409 VERSION_CONFLICT` with the current Site GeoJSON Feature at `error.details.current`.
- [ ] `/docs` and root README document the implemented authentication and authorization behavior and development accounts.
- [ ] Automated tests pass; verified criteria are checked and any gaps remain unchecked.

## Git instructions for this Step

Implement only Step 5. Verify the starting branch/worktree and completed prerequisite commits, run the authentication, authorization, audit, and concurrency checks above, review the diff and source data, stage only Step 5 files, and commit the completed verified unit with the `step-5:` prefix. Do not begin Step 6 automatically.
