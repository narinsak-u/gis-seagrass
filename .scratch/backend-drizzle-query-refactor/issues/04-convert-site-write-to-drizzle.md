# 04: Convert Site write repository (R6) to Drizzle builder while preserving locking and deriveSiteSpatial

**What to build:** Convert routine create, import, lock, distance, and update queries in `DrizzleSiteWriteRepository` to Drizzle builder while retaining `deriveSiteSpatial()` as a documented raw-SQL exception and preserving `FOR UPDATE` serialization, `DUPLICATE_CODE` translation, and optimistic version increments.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] **R6 (`drizzle-site-write.repository.ts`):** Convert `create`, `import` (`.onConflictDoNothing()`), `lock` (`.for('update')`), `lockForSurvey` (`.for('update')`), `withinDistance`, and both `update` branches (spatial + name-only, with atomic `version: sql\`${sites.version} + 1\``) to Drizzle builder.
- [ ] Verify PostgreSQL unique-constraint error translation (`23505` / `uq_sites_code` → `ApplicationError('DUPLICATE_CODE', ...)`) still works through Drizzle's error cause chain.
- [ ] Keep `deriveSiteSpatial()` as the documented raw-SQL `WITH ... MATERIALIZED` CTE with a concise rationale comment.
- [ ] Confirm `backend` build, Site create/patch/delete/concurrency integration tests, and Site importer tests pass on disposable PostGIS.
