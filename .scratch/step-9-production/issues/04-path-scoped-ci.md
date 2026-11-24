# 04: Path-scoped test-only CI

**Status:** resolved
**Spec:** `specs/step-9-production.md` S9-07, S9-08

- [x] Backend workflow triggers on `backend/**` and its own workflow path; `npm ci` then `npm run test:unit` only, no DB service.
- [x] Frontend workflow triggers on `frontend/**` and its own workflow path; `npm ci` then `npm test` only.
- [x] Both application paths trigger both, docs-only trigger neither. No Docker build, push, deploy, or E2E jobs.
- [x] Validate YAML/path filtering locally; state explicitly integration/PostGIS and Playwright are not CI coverage, and disclose lack of remote green run if unavailable.

Remote GitHub Actions execution was unavailable. Local YAML parsing and path-filter checks passed.
