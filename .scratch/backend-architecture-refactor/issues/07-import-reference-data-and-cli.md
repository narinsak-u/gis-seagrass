# 07: Move importer reference-data workflow

**What to build:** Operators can run the standalone importer with the same source parsing, Province/Species seeding, rejection reports, and repeatable results.

**Blocked by:** 01: Add the Drizzle provider and AuthGuard pilot.

**Status:** ready-for-agent

- [ ] Import parsing, reporting, and CLI orchestration remain independent from HTTP DTOs and do not require starting the Nest application.
- [ ] Province and Species seed persistence belongs to Import infrastructure and preserves existing validation, idempotency, and reported outcomes.
- [ ] The importer keeps its pinned-session advisory lock and explicit provider lifecycle; failures release the lock and close the provider.
- [ ] Disposable-database CLI tests cover valid, duplicate, and rejected source records, repeat runs, and concurrent importer serialization.
