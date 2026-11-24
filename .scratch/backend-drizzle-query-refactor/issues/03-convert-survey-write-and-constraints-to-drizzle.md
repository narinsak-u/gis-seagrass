# 03: Convert Survey write and constraint repositories (R5 & R7) to Drizzle builder

**What to build:** Convert remaining raw `.execute` calls in `DrizzleSurveyWriteRepository` and `DrizzleSiteSurveyConstraintRepository` to Drizzle builder while preserving outer `tx` boundaries, row locking, idempotent import conflict handling, and transactional `siteStatus` responses.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] **R5 (`drizzle-survey-write.repository.ts`):** Convert `import` (using `.onConflictDoNothing({ target: surveys.surveyRef, where: sql\`${surveys.surveyRef} IS NOT NULL\` })`), `today` (tableless `tx.select(...)`), `create`, and `response` survey projection to Drizzle builder.
- [ ] Reuse the shared internal `surveys/infrastructure/` latest-date cover-percentage helper inside `DrizzleSurveyWriteRepository.response(tx, id)` so mutation responses use the exact same `siteStatus` logic on the active transaction.
- [ ] **R7 (`drizzle-site-survey-constraint.repository.ts`):** Express `hasSurveys` and `hasSurveysOutside` via Drizzle builder (keeping geography-based 50 m `ST_DWithin` database-side), or document a concise exception comment if raw `EXISTS` is materially clearer.
- [ ] Confirm `backend` build, unit tests, Survey write/concurrency integration tests, and Survey importer tests pass on disposable PostGIS.
