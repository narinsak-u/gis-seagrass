# 03: Read Sites intersecting a bbox as GeoJSON

**What to build:** Map clients can fetch active Site Features for a bounded viewport, including Sites that touch its edge, with predictable ordering and filters.

**Blocked by:** 02: Read a Site with its latest Survey.

**Status:** resolved

- [x] `GET /sites.geojson` requires four finite WGS84 bbox numbers in longitude/latitude order with strictly increasing longitude and latitude bounds; missing, zero-size, inverted, malformed, or out-of-range bounds return `400 INVALID_BBOX`.
- [x] A valid request returns `200` GeoJSON FeatureCollection with active matching Sites ordered by code and Feature properties/geometry consistent with Site detail, excluding `latest_survey`.
- [x] PostGIS spatial intersection includes boundary contact; province filtering works as on the list and unsupported status returns `400 VALIDATION_ERROR`.
- [x] Real HTTP/PostGIS tests cover interior, boundary, nonintersecting, deleted, and province-filtered Sites plus invalid bbox cases.
## Comments

Parent build and 5 isolated HTTP/PostGIS bbox tests passed. Merged `step-3/t03fix` at `0244c5fccc221bccfd4f3abb325d411a2416b165`.
