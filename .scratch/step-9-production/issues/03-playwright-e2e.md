# 03: Isolated Playwright E2E

**Status:** resolved
**Blocked by:** 01, 02 for runtime verification
**Spec:** `specs/step-9-production.md` S9-05, S9-06

- [x] Place Playwright config/specs in `frontend/`, using the real gateway origin and isolated seeded PostGIS Compose project; keep reports/traces ignored.
- [x] Cover E2E-01–05: public map/polygons, pan to a second seeded province with bounded bbox requests, map/table filter synchronization and row zoom, Site name/status with protected Survey history, viewer login/logout.
- [x] Cover E2E-06 with an admin Survey API write and UI readback of new history and derived Site status; E2E-07 with editor role shown plus admin-only API write rejected 403. Do not add mutation UI.
- [x] Use per-run disposable viewer/editor/admin credentials, independent fixtures/cleanup, semantic locators, reliable network assertions; validate app layers without relying on external basemap uptime.
- [x] Run against disposable project; document setup, repeatability and cleanup of only owned resources.
