# 03: Import Sites with province assignment

**What to build:** A developer running the import command gets trustworthy Sites assigned to provinces with server-calculated rai area. Invalid Site shapes are reported; a Soft-deleted site stays historical, not recreated or restored.

**Blocked by:** 01: Import provinces on startup.

**Status:** resolved

- [x] Sites require code, name, valid nonempty WGS84 Polygon/MultiPolygon geometry; PostGIS rejects malformed or self-intersecting shapes without swaps or repairs.
- [x] Each accepted Site has a province with strictly positive geographic overlap, chosen by largest overlap area and province code on ties; touch-only shapes are rejected.
- [x] Each stored Site has server-computed geographic area in rai rounded to two decimals, MultiPolygon 4326 geometry, initial version one, and nullable import attribution.
- [x] The first valid source code wins, later duplicates are reported, and any existing Site code is skipped without overwrite, including a Soft-deleted site code.
- [x] The same startup and manual command reports Site insert/skip/reject counts and reproducible source positions; repeat runs preserve original Site values.
- [x] Import-backed PostGIS tests cover invalid geometry, Polygon conversion, overlap/touch/tie cases, rai area, duplicates, idempotency, and the Soft-deleted site policy.
