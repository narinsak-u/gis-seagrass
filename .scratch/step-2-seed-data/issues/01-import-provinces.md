# 01: Import provinces on startup

**What to build:** A developer can start the existing three-service stack or run one backend command to import supplied province boundaries after migrations. Invalid features appear in a tracked, host-accessible CSV report; healthy startup means import finished. The four original sources stay committed and unchanged.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The four supplied sources are committed unchanged; the API reads them through a read-only mount, and only the existing three services run.
- [x] One documented backend command reads the province FeatureCollection, validates required fields, WGS84 coordinates, nonempty PostGIS geometry, and Polygon/MultiPolygon representation without repairing invalid shapes.
- [x] The first valid source code is stored as MultiPolygon 4326; later source duplicates are rejected and previously stored codes are skipped without overwrite.
- [x] The host CSV report is tracked, has escaped UTF-8 `file,row,reason` fields, uses one-based GeoJSON feature positions, and includes source errors on repeated imports.
- [x] Compose waits for a healthy DB, runs migrations and this import before API readiness; unreadable or malformed whole files and database errors prevent healthy startup.
- [x] An import-backed database test shows accepted boundaries, rejected features, source duplicate handling, and unchanged data on rerun; existing geometry indexes remain available.
