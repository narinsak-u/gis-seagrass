# 06: Move Survey writes and shared transactions

**What to build:** Admins can create, correct, and delete Surveys without breaking Site distance, species, audit, or concurrency guarantees.

**Blocked by:** 04: Move Site writes and version conflicts; 05: Move protected Survey reads.

**Status:** resolved

- [ ] Survey create, PATCH, and delete require an active admin and preserve existing response, validation, and error contracts.
- [ ] The coordinator passes one opaque transaction context through Site and Survey repository contracts. The `SiteSurveyModule` binds feature-owned repositories; Import infrastructure may compose the same operations for the standalone CLI. No feature application code or controller imports peer infrastructure, and no circular feature-module dependency exists.
- [ ] Survey geometry remains within 50 meters of an active Site; species writes stay atomic; create/update audit fields remain server-owned, including species-only PATCH.
- [ ] Hard deletion removes species links and retains no actor history; derived Site status reflects create, update, and delete without a cache.
- [ ] Real HTTP/PostGIS tests cover authorization order, audit, species, distance, deletion, and races with Site geometry edits or deletion.
