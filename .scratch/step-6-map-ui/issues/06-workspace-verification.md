# 06: Workspace completion and verification

**What to build:** A visitor can use the complete map workspace across desktop and 375 px mobile layouts, including failure and empty states, with accessible controls and documentation that matches verified behavior.

**Blocked by:** 02: Synchronized Site table and filters; 03: Province boundaries; 05: Protected selected-Site Survey history and points.

**Status:** ready-for-agent

- [ ] Map, table, detail, login, Province layer, and Survey history expose loading, retryable errors, empty results, and no-history states without hiding unrelated public data.
- [ ] Filters, table, detail, login, legend, and map controls work at 375 px without horizontal page overflow and remain operable by keyboard with accessible labels.
- [ ] Browser scenarios verify row-to-map and polygon-to-detail selection, matching filters, Province boundaries, Survey role gates, expired-token public browsing, and visible basemap attribution.
- [ ] Run Step 6's targeted automated checks and browser verification; leave any unmet definition-of-done criterion unchecked and report its gap.
- [ ] Root documentation describes only implemented and verified frontend features, startup commands, and remaining limitations; do not begin Step 7.
