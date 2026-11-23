# 03: Move public Site reads and status

**What to build:** Visitors can read the same public Site list, map GeoJSON, and detail responses, including current Site status.

**Blocked by:** 01: Add the Drizzle provider and AuthGuard pilot.

**Status:** ready-for-agent

- [ ] Public Site list, GeoJSON, and detail routes preserve their existing filters, pagination, response shapes, and active-Site visibility.
- [ ] Every public Site read includes current derived `siteStatus`, including `no_data`; latest-date averaging and recomputation after Survey changes remain intact.
- [ ] Site-status reads use the agreed Site–Survey application seam without direct cross-module table or infrastructure access.
- [ ] Real HTTP/PostGIS tests cover all public response shapes and status edge cases; OpenAPI remains accurate.
