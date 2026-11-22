# 07: Document and verify the complete Site API

**What to build:** Developers can explore every implemented Site route in Swagger UI, fetch its OpenAPI JSON, and follow verified startup and request examples. The published contract matches observed API behavior.

**Blocked by:** 03: Read Sites intersecting a bbox as GeoJSON; 06: Soft-delete Sites without linked Surveys.

**Status:** ready-for-agent

- [ ] `/docs` serves usable Swagger UI and `/docs-json` serves OpenAPI JSON describing all six Site routes, query/body schemas, success responses, and the shared error schema with documented failure statuses/codes.
- [ ] Browser smoke verifies Swagger UI loads and exposes the Site operations; HTTP contract checks verify the JSON document and shared error schema.
- [ ] Run the complete Step 3 API and isolated PostGIS checks; compare each implemented route and failure pair with the agreed Step 3 contract, and leave unmet Definition-of-done boxes unchecked.
- [ ] Root README includes only verified Step 3 capabilities, startup/test commands, working request examples, and the unauthenticated-write limitation; design documentation reflects the agreed overlap and Survey-preservation rules.
- [ ] Review the completed Step 3 diff and source-data integrity; commit only verified Step 3 changes with the required prefix. Do not start Step 4.
