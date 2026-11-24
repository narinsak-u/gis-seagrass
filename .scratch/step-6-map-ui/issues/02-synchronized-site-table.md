# 02: Synchronized Site table and filters

**What to build:** A visitor can use a table and map as two views of the same viewport Sites, filter and search them consistently, and inspect a selected Site from either view.

**Blocked by:** 01: Map and viewport Site browsing.

**Status:** resolved

- [x] The table lists only active Sites from the current bbox response and paginates filtered features locally; it never presents nationwide `/sites` pages as viewport results.
- [x] Province selection is sent to the bbox endpoint; dropdown options derive from the viewport (retaining known options and the active selection while filtered, with an "All provinces" clear option). Province, `siteStatus`, and case-insensitive Site code/name substring search affect table rows and map polygons identically; `status=active` is never confused with `siteStatus`.
- [x] Row selection zooms/pans to and highlights its Site polygon; polygon selection selects the corresponding table row and opens Site detail.
- [x] Detail shows Site identity, current API status, and public latest Survey summary when present; no Survey history is fetched in this ticket.
- [x] Table and detail show loading, empty, and recoverable error states; controls are labeled and keyboard-operable.
- [x] Browser checks exercise filters, both selection paths, viewport changes, and detail; focused tests cover matching results where needed.
