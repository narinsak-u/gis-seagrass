# 06: Move Survey writes and shared transactions

**What to build:** Admins can create, correct, and delete Surveys without breaking Site distance, species, audit, or concurrency guarantees.

**Blocked by:** 04: Move Site writes and version conflicts; 05: Move protected Survey reads.

**Status:** ready-for-agent

- [ ] Survey create, PATCH, and delete require an active admin and preserve existing response, validation, and error contracts.
- [ ] The Site–Survey coordinator shares one Drizzle transaction across module-owned persistence ports; no circular dependency or direct cross-module data access remains.
- [ ] Survey geometry remains within 50 meters of an active Site; species writes stay atomic; create/update audit fields remain server-owned, including species-only PATCH.
- [ ] Hard deletion removes species links and retains no actor history; derived Site status reflects create, update, and delete without a cache.
- [ ] Real HTTP/PostGIS tests cover authorization order, audit, species, distance, deletion, and races with Site geometry edits or deletion.
