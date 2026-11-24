# 01: Baseline verification, query inventory, and search wildcard tests

**What to build:** Establish clean baseline build/test evidence against a disposable PostGIS database, classify all 23 `.execute` statements across R1–R7, and add integration test coverage for literal `%`, `_`, and `\` search terms in `GET /sites?q=`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Run `npm --prefix backend run build` and `npm --prefix backend test` against an isolated disposable PostGIS database via `IMPORT_TEST_DATABASE_URL`, recording exact counts and pass/fail status.
- [ ] Verify and record classification (`convert`, `hybrid`, or `retain with reason`) for every `.execute` statement across R1–R7 (noting `import/infrastructure/reference-data.ts`, `advisory-lock.ts`, and `health.controller.ts` stay untouched).
- [ ] Add integration test cases in `backend/tests/sites/sites.controller.read.integration.spec.ts` verifying `GET /sites?q=` treats literal `%`, `_`, and `\` as substring characters rather than `LIKE` wildcards.
- [ ] Verify the new test passes before refactoring queries.
