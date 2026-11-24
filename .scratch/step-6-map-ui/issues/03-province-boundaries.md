# 03: Province boundaries

**What to build:** A visitor can see actual Province boundaries for the current map viewport alongside Sites, without loading nationwide Province geometry.

**Blocked by:** 01: Map and viewport Site browsing.

**Status:** ready-for-agent

- [ ] Public `GET /provinces.geojson?bbox=minLon,minLat,maxLon,maxLat` (implemented within Sites' flat ADR-0002 layers without creating an empty Province domain module) returns a GeoJSON FeatureCollection sorted by `code` of intersecting Province MultiPolygons with `properties: { code, name_th }` matching Site `province_code`.
- [ ] Missing, malformed, out-of-range, zero-size, and inverted bbox values fail using the shared Site bbox validation and shared API error envelope.
- [ ] The map requests Province geometry for its current viewport and replaces it after settled movement; stale responses cannot overwrite the current layer, and viewport Province features enrich the Province filter dropdown labels (`code` + `name_th`) while retaining any active selection.
- [ ] Boundaries are visually distinct from the basemap's administrative lines; loading, empty, and recoverable error states do not hide public Sites.
- [ ] Existing backend HTTP integration patterns verify geometry, intersection including boundary contact, and bbox errors; browser verification confirms the layer follows the viewport.
