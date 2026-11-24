# 05: Full regression suite, DESIGN.md & ADR-0003 documentation, and independent verification

**What to build:** Validate the complete refactor against disposable PostGIS, inspect generated SQL and `git diff`, document the Drizzle-first query policy and raw-SQL exceptions in `DESIGN.md` and `docs/adr/0003-drizzle-first-query-policy.md`, and complete independent verification before committing with `refactor:`.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Run `npm --prefix backend run build` and full `npm --prefix backend test` against an isolated disposable PostGIS database; verify zero skipped/relaxed assertions and clean fixture teardown.
- [ ] Inspect `git diff` and generated SQL / parameterization across R1–R7, and manually check Clean Architecture boundaries against `DESIGN.md` and ADR-0002 (no NestJS/Drizzle/`pg` imports in `domain/` or `application/`, no schema/migration/API contract changes).
- [ ] Update `DESIGN.md` and add `docs/adr/0003-drizzle-first-query-policy.md` documenting the Drizzle-first query policy and every retained raw-SQL exception.
- [ ] Run `/verify` against the confirmed spec, tickets, ADRs, code, and test evidence, resolve any findings, and commit scope-relevant files with `refactor:` prefix.
