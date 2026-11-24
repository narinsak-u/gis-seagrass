# 05: Document and verify Step 9

**Status:** resolved
**Blocked by:** 01, 02, 03, 04
**Spec:** `specs/step-9-production.md` S9-09 and definition of done

- [x] Update README gateway, test-only E2E, CI commands, login-throttle policy, limitations; update DESIGN and roadmap, supersede Step 6's historical Next.js proxy decision.
- [x] Run backend unit/integration tests on disposable PostGIS, frontend tests, gateway config/routing/error/throttle smoke, and isolated E2E; no default development volume or seed modification.
- [x] Independently verify every Step 9 acceptance item; record actual evidence and check only verified criteria.
- [x] Commit completed verified work with `step-9:` prefix; report hash and remaining limitations.

Verification: backend unit 6 passed; PostGIS integration 73 passed; frontend 66 passed; E2E 7 passed. Caddy config, routing, Swagger, `/api` and `/api/`, 401/429/502, spoofed X-Forwarded-For, and unaffected GET behavior passed disposable-stack checks. Workflow YAML and path filters passed locally. GitHub Actions execution was unavailable.
