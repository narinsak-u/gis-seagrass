# 05: Restructure Import while preserving the standalone CLI

**What to build:** Operators keep the same import results and reports through a standalone CLI with explicit parser, application, and infrastructure responsibilities.

**Blocked by:** 03: Restructure Sites into physical layers; 04: Restructure Surveys and Site–Survey coordination.

**Status:** resolved

- [x] Import source parsing, CLI orchestration, and Province/Species persistence have explicit parser, application, and infrastructure ownership.
- [x] The CLI remains independent of Nest startup and HTTP DTOs; Site and Survey writes use their public application operations.
- [x] The pinned advisory lock, provider ownership, per-Survey transactions, idempotency, and rejection reports remain unchanged.
- [x] Existing importer CLI tests and backend build pass.
