# Backend Persistence Refactor — Drizzle-First Query Policy

Status: Implemented and verified (25/25 backend test files, 81/81 tests passing on isolated disposable PostGIS; two-axis code review and independent `/verify` complete)  
Canonical spec: [`specs/backend-drizzle-query-refactor.md`](../../specs/backend-drizzle-query-refactor.md)

## Summary

Convert routine `db.execute` / `tx.execute` raw SQL statements in `backend/` infrastructure repositories to Drizzle ORM query builder calls with parameterized `sql<T>` expressions for PostgreSQL/PostGIS functions, preserving all HTTP contracts, PostGIS semantics, `FOR UPDATE` locking, optimistic version checks, transactions, and importer idempotency.

## Verified `.execute` Inventory (`23` in scope + `1` import untouched)

| File | `.execute` calls | Scope & Plan |
| --- | --- | --- |
| `backend/src/surveys/infrastructure/drizzle-survey-list.repository.ts` (R1) | `1` | Convert paginated list join + `array_agg` to Drizzle builder |
| `backend/src/sites/infrastructure/drizzle-site-read.repository.ts` (R2) | `4` | Convert `list` count, `list` rows, `detail`, `withinBbox`; keep `strpos(lower(...))` with schema refs |
| `backend/src/sites/infrastructure/drizzle-province-read.repository.ts` (R3) | `1` | Convert `withinBbox` to Drizzle builder |
| `backend/src/surveys/infrastructure/drizzle-survey-status.repository.ts` (R4) | `2` | Convert `latestSurvey` to Drizzle builder; convert `latestCoverPercentages` (or retain with rationale) and share internal `surveys/infrastructure/` helper |
| `backend/src/surveys/infrastructure/drizzle-survey-write.repository.ts` (R5) | `5` | Convert `import` (`.onConflictDoNothing({ target, where })`), `today`, `create`, `response` row, and `response` site-status aggregate |
| `backend/src/sites/infrastructure/drizzle-site-write.repository.ts` (R6) | `8` | Convert `create`, `import`, `lock`, `lockForSurvey`, `withinDistance`, `update` (both branches); retain `deriveSiteSpatial()` raw CTE |
| `backend/src/surveys/infrastructure/drizzle-site-survey-constraint.repository.ts` (R7) | `2` | Convert `hasSurveys` / `hasSurveysOutside` `EXISTS` checks unless noisier |
| `backend/src/import/infrastructure/reference-data.ts` (R7) | `1` | Leave untouched |

## Confirmed Decisions

1. **Pragmatic raw-SQL exception boundary:** Keep `deriveSiteSpatial()` as full raw SQL (`WITH ... MATERIALIZED`). Convert `today()`, CRUD, joins, and locks to Drizzle builder; convert `latestCoverPercentages` and `EXISTS` unless the builder version is materially noisier, documenting any retained `execute` exception with a one-line comment and doc/ADR entry.
2. **Text search predicate:** Keep `strpos(lower(${sites.code}), lower(${search})) > 0` and `strpos(lower(${sites.name}), lower(${search})) > 0` inside Drizzle `.where(and(...))` and add integration tests for literal `%`, `_`, and `\`.
3. **Projection casts & helpers:** Keep inline `sql<T>` casts/PostGIS fragments by default; extract small typed helpers only where genuinely repeated without building a generic GIS wrapper.
4. **Latest-date status query sharing:** Extract one internal helper in `surveys/infrastructure/` (`db` or `tx`) shared by `DrizzleSurveyStatusRepository` and `DrizzleSurveyWriteRepository`.
5. **Disposable PostGIS verification:** Run baseline and post-refactor tests against `IMPORT_TEST_DATABASE_URL` pointing at a disposable PostGIS DB (no `architecture.spec.ts` exists per ADR-0002; verify layer boundaries manually against `DESIGN.md` and ADR-0002).
6. **Documentation & ADR:** Update `DESIGN.md` and add `docs/adr/0003-drizzle-first-query-policy.md`.
