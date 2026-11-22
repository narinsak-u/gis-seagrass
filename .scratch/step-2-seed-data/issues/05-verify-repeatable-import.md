# 05: Verify repeatable full-stack import

**What to build:** A developer can run imports concurrently or restart the normal stack without losing existing observations, altering original sources, or losing rejection evidence. The project documents observed counts, the host report, and known limits.

**Blocked by:** 04: Import surveys and species links.

Status: ready-for-agent

- [ ] Concurrent import runs serialize through an exclusive PostgreSQL advisory lock, while database uniqueness constraints protect persisted identities; failures remain visible rather than silently hidden.
- [ ] A full import reports inserted, skipped-existing, and rejected totals per source. A second run preserves all table counts and representative values while reporting the same source-internal errors.
- [ ] A normal Compose shutdown and restart preserves data, repeats migration then import before API readiness, and does not erase the database volume or original sources.
- [ ] The tracked host report contains accurate source, position, and reason for actual rejected records; source bytes remain unchanged and no secrets or DB volumes are committed.
- [ ] Tests cover concurrent runs, all persisted relationships, representative geographic values, report fidelity, rerun stability, and fatal infrastructure failures.
- [ ] User documentation explains commands, stable report location, verified actual counts and reasons, reruns, and limits; design documentation records the reserved Soft-deleted site policy. Compare every Step 2 Definition of done item with observed behavior before marking it complete.
