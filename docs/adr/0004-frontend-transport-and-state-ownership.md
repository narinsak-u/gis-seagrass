---
status: accepted
---

# Frontend Transport and State Ownership

Use one Axios client for same-origin `/api/*` requests, a 10-second timeout, cancellation, normalized transport errors, Zod at consumed response boundaries, TanStack Query for remote data and request lifecycle, and Zustand for shared UI and memory-only session state. This replaces custom Fetch transport and subscription/request controllers with one owner per concern; Axios adds a dependency and migration cost, but provides one place for transport defaults and error normalization. Feature API boundaries parse Site, Province, Survey, login, and identity responses with Zod. Protected feature API calls pass tokens explicitly to the client, including `/auth/me` before the new session is published; public calls send no token. Tokens stay out of query keys and persistent storage. Survey history keys include the session epoch to isolate account changes. MapLibre owns rendering and interactions, not network state.
