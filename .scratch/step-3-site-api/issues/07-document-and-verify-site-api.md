# 07: Document and verify the complete Site API

**What to build:** Developers can explore every implemented Site route in Swagger UI, fetch its OpenAPI JSON, and follow verified startup and request examples. The published contract matches observed API behavior.

**Blocked by:** 03: Read Sites intersecting a bbox as GeoJSON; 06: Soft-delete Sites without linked Surveys.

**Status:** resolved

- [x] `/docs` serves usable Swagger UI and `/docs-json` serves OpenAPI JSON describing all six Site routes, query/body schemas, success responses, and the shared error schema with documented failure statuses/codes.
- [x] Browser smoke verifies Swagger UI loads and exposes the Site operations; HTTP contract checks verify the JSON document and shared error schema.
- [x] Run the complete Step 3 API and isolated PostGIS checks; compare each implemented route and failure pair with the agreed Step 3 contract, and leave unmet Definition-of-done boxes unchecked.
- [x] Root README includes only verified Step 3 capabilities, startup/test commands, working request examples, and the unauthenticated-write limitation; design documentation reflects the agreed overlap and Survey-preservation rules.
- [x] Review the completed Step 3 diff and source-data integrity; commit only verified Step 3 changes with the required prefix. Do not start Step 4.

## Comments

- Verification: isolated PostGIS suite passed 37/37 tests; the rollback-only schema check passed. Live API startup imported 3 provinces, 27 Sites, and 274 Surveys.
- Browser verification: `/docs` loaded in Chromium and showed all six Site operations plus the shared error schema. Expanded `GET /sites` showed `pageSize`, `page`, `q`, `province`, and `status`.
- Live HTTP verification: README GET examples succeeded; `/docs-json` returned HTTP 200.
- Integration tip `3d58c34` (`fix(sites): type error schema as reference`) is present on this branch. Step 4 remains untouched.
