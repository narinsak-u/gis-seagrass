# 04: Import surveys and species links

**What to build:** A developer running the same import command gets only valid surveys linked atomically to active Sites and known species. Rejected observations have actionable positions and reasons in the host report.

**Blocked by:** 02: Import species; 03: Import Sites with province assignment.

**Status:** resolved

- [x] A real UTF-8 CSV parser handles quoting, required headers, and physical/record positions with the header counted as line one. The first survey reference in the source wins; later duplicates are reported.
- [x] Surveys refer only to persisted active Sites; a missing or Soft-deleted site gives `SITE_NOT_FOUND`. Finite WGS84 point coordinates and PostGIS geography distance within 50 meters inclusive are required.
- [x] Cover is finite and within 0–100 inclusive; dates are strict valid `YYYY-MM-DD` not later than today in Bangkok; every nonempty `|`-separated species code must exist.
- [x] Each accepted survey and its species links commit atomically; no rejected row leaves a partial survey or association. Existing survey references skip without overwrite.
- [x] The import command reports actual survey insert/skip/reject totals; the CSV report includes escaped file, position, and reason for source errors even on rerun.
- [x] Parser and PostGIS-backed tests cover quoted CSV, duplicate references, 30/50/200-meter points, cover boundaries, Bangkok date boundaries, missing and Soft-deleted sites, unknown species, atomic links, and stable reruns.
