# 08: Route imported Sites and Surveys through their modules

**What to build:** Operators can import Sites and Surveys through the same module-owned rules as API writes, while the full backend meets its architecture and behavior contracts.

**Blocked by:** 04: Move Site writes and version conflicts; 06: Move Survey writes and shared transactions; 07: Move importer reference-data workflow.

**Status:** resolved

- [ ] Import delegates Site and Survey persistence to their owning application operations and the Site–Survey coordinator.
- [ ] The CLI preserves source parsing, rejection reasons, idempotency, the pinned advisory lock, per-Survey transactions, and full import reports.
- [ ] No HTTP controller or application use case performs direct database queries; domain rules remain framework-independent and each module owns its persistence.
- [ ] Update `DESIGN.md` with final module ownership, provider lifecycle, Site–Survey collaboration, and Drizzle/SQL trade-offs.
- [ ] Full backend build and existing HTTP/PostGIS and importer tests pass against disposable resources; Step 6 remains unchanged.
