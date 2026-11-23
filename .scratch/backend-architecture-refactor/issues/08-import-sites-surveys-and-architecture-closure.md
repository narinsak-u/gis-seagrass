# 08: Route imported Sites and Surveys through their modules

**What to build:** Operators can import Sites and Surveys through the same module-owned rules as API writes, while the full backend meets its architecture and behavior contracts.

**Blocked by:** 04: Move Site writes and version conflicts; 06: Move Survey writes and shared transactions; 07: Move importer reference-data workflow.

**Status:** resolved

- [ ] Import delegates Site and Survey work to their public application operations and coordinator. Its infrastructure may bind owning repository implementations as the standalone CLI composition root; it does not implement their data access.
- [ ] The CLI preserves source parsing, rejection reasons, idempotency, the pinned advisory lock, per-Survey transactions, and full import reports.
- [ ] No HTTP controller or application use case performs direct database queries; feature repositories own persistence. Concrete cross-feature repository imports are limited to the Site–Survey and CLI composition roots.
- [ ] Update `DESIGN.md` with final module ownership, provider lifecycle, Site–Survey collaboration, and Drizzle/SQL trade-offs.
- [ ] Full backend build and existing HTTP/PostGIS and importer tests pass against disposable resources; Step 6 remains unchanged.
