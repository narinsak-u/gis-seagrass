# 01: Stock Caddy gateway and Compose topology

**Status:** ready-for-agent
**Spec:** `specs/step-9-production.md` S9-01, S9-02, S9-04, S9-06

- [ ] Pin stock Caddy, route `/` to `web:3000`, `/api/*` to unprefixed `api:3000`, and preserve Swagger assets/API description without routing non-API paths to Nest.
- [ ] Return the existing JSON `UPSTREAM_UNAVAILABLE` 502 envelope through `handle_errors`; pass backend errors and Authorization unchanged.
- [ ] Overwrite incoming forwarded client-IP headers at Caddy for the Nest login limiter.
- [ ] Make only gateway/browser port loopback-published; DB stays loopback, API/Web internal. Reuse isolated Compose override with unique gateway port, volume, DB credentials and report path.
- [ ] Validate the Caddyfile with its actual image and smoke `/`, `/api/health`, `/api/docs`, `/api` edge cases, 401/403, 502, and `/_next/*` against disposable stack.
