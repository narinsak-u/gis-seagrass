# 02: NestJS login-only throttling

**Status:** resolved
**Spec:** `specs/step-9-production.md` S9-03, S9-04

- [x] Add `@nestjs/throttler` for only `POST /auth/login`, 20 attempts per 60 seconds per client IP, including successful, failed and malformed requests.
- [x] Trust one proxy hop; Caddy scrubs incoming client-IP forwarding. Direct API host access stays disabled in Compose.
- [x] Preserve shared error envelope for 429; all other routes remain unthrottled by this guard.
- [x] Add deterministic integration coverage for boundary, unaffected routes and proxy identity/spoofing where feasible; keep existing login contract tests valid.
- [x] Document single-process memory storage, restart reset and horizontally scaled limit.
