# 02: Public Site status

**What to build:** Anyone can read each Site's current seagrass-cover assessment from the public Site list, map GeoJSON, and Site detail, even without a Survey-read token.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Public `GET /sites` list items include `siteStatus`; public `GET /sites.geojson` features and `GET /sites/:code` detail expose `siteStatus` in feature properties. Existing filters, pagination, active-Site visibility, and other read fields remain intact.
- [x] `siteStatus` is derived from all Surveys on the latest observation date using Step 4 thresholds; earlier Surveys do not affect it, and a Site with no Surveys returns `no_data`. It reflects Survey create, update, and delete without a cached value.
- [x] Site POST and PATCH success shapes remain unchanged; no new status filter or authentication requirement is introduced on Site reads.
- [x] Generated OpenAPI and root README describe only the verified public response additions.
- [x] Real HTTP/PostGIS tests cover every public read shape, an empty Site, multiple latest-date Surveys, exclusion of older dates, and recomputation after mutation. Fixture changes remain isolated and safe for the full suite.
