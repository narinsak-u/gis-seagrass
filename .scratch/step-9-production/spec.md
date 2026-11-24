Status: resolved

# Step 9 — Gateway, E2E and unit-only CI

Canonical requirements and acceptance: [Step 9 spec](../../specs/step-9-production.md). Steps 1–6 are complete; Steps 7–8 are not prerequisites.

## Confirmed decisions

- Stock pinned Caddy on loopback port 8080 is the sole browser entrypoint. `/` goes to `web:3000`, `/api/*` strips `/api` and goes to `api:3000`. API and Web have no host ports; DB remains loopback-only.
- Delete Next.js API route/proxy and its tests. Caddy emits the existing JSON `UPSTREAM_UNAVAILABLE` 502 envelope on upstream failure. Browser API calls stay relative `/api/*`; standalone `next dev` is UI-only without Caddy.
- Only `POST /auth/login` is throttled: NestJS `@nestjs/throttler`, 20 attempts per 60 seconds per client IP, 429 envelope. Caddy overwrites incoming X-Forwarded-For, and Nest trusts one hop. State is in-memory and reset on restart; other writes are not limited.
- Playwright E2E uses a unique disposable Compose project and real frontend/API/PostGIS. Step 6 has no mutation controls: admin Survey creation and editor-forbidden mutation are API requests with UI observation, not invented Step 7 UI.
- CI has independent backend and frontend path-scoped workflows. Backend runs only `npm run test:unit`; frontend runs `npm test`. PostGIS integration and browser E2E are local verification, not CI coverage. No CI image build, push, or deployment.

## Traceability

Tickets 01–05 cover S9-01 through S9-09. The existing Step 6 proxy decision is historical and superseded here. Do not modify seed inputs or the default development Compose volume during verification.
