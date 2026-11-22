---
name: verify
description: Verify Step N against main and confirmed specs, tickets, accepted ADRs, code, and tests. Non-destructive; use for "verify Step N".
---

# Verify Step N

Audit only. Never edit source, specs, seed data, existing databases, or Git; never commit or start another Step. Isolated disposable test resources are allowed.

## 1. Read

- Identify Step N. Read `AGENTS.md` (where applicable), `specs/README.md`, and `specs/step-N-*.md`.
- Read the matching `.scratch/` confirmed spec and tickets/issues; ensure they belong to N. Find relevant ADRs wherever stored.
- Record `git status --short` before checking. Report missing or ambiguous sources.

**Priority:** project rules → main spec → confirmed spec → tickets. An **accepted ADR** may override only explicitly identified requirements for Step N. Cite its decision; absent, draft, or ambiguous ADRs do not resolve conflicts.

## 2. Verify

For each required criterion, compare specs/tickets with implementation and tests. Include edge cases and actual call paths. Classify **once**:

- **pass** — code evidence plus executed behavioral evidence when required.
- **fail** — proven violation, missing implementation, or unresolved spec conflict.
- **unverified** — missing evidence/source or unsafe/unavailable execution.

Cite `path:line` and test results. Checkboxes and unrun tests are not proof. Ignore optional and future-Step criteria for the verdict.

## 3. Run safe checks

- Inspect commands first. Run non-fixing lint/typecheck and unit tests if writes stay in disposable locations.
- Run integration tests only on a **confirmed isolated, disposable** DB/container/schema; never on existing dev/prod data or shared volumes.
- No fixes, snapshots updates, migrations/imports against existing data, or changes to tracked files. Clean up only resources created for verification.
- Record results/skips and compare Git status before/after. Pre-existing dirty state alone is not failure.

## 4. Report (chat only)

```markdown
Step N — Verification | Worktree: clean/dirty
Sources: main, scratch, tickets, ADRs (paths/missing)
Failed (N): [ID] requirement — reason; evidence
Unverified (N): [ID] requirement — missing evidence/check
Passed (N): [ID] requirement — path:line; executed check if needed
Checks: command — pass/fail/skipped (reason; DB isolation if used)
ADRs applied: path → requirement | none
Conflicts/gaps: ... | none
Verdict: verified | not verified — reason
```

List each required criterion exactly once. **Verified** only when all pass; otherwise **not verified**. Never fix, mark complete, write a report file, or commit.
