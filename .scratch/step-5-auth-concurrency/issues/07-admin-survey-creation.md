# 07: Admin Survey creation

**What to build:** An admin can record a new Survey and its species associations with their identity attached. Other callers cannot create observations or probe the target Site.

**Blocked by:** 03: Protected Survey reads.

**Status:** ready-for-agent

- [ ] `POST /sites/:code/surveys` requires an active admin token. Missing/invalid tokens return `401 UNAUTHORIZED`; viewer/editor tokens return `403 FORBIDDEN` before validation or Site lookup, including missing and soft-deleted Sites.
- [ ] A successful write stores authenticated `created_by` and `updated_by` and server `updated_at`, keeping species associations atomic, 50-meter geography validation, Bangkok date validation, and the Step 4 `201` response with derived `siteStatus` but without extra creator fields. Reject or ignore client-supplied audit fields.
- [ ] Subsequent protected Survey reads show the creator ID; previous imported Surveys continue to show null.
- [ ] OpenAPI and README document the implemented admin-only create route. Real HTTP/PostGIS tests cover roles, actor persistence, forged actors, invalid locations/species, and active-Site races; adapt existing API fixtures and preserve suite-wide success.
