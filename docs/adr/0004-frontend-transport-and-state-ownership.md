---
status: accepted
---

# Frontend Transport and State Ownership

Use one Axios client for same-origin `/api/*` requests, Zod at consumed response boundaries, TanStack Query for remote data and request lifecycle, and Zustand for shared UI and memory-only session state. This replaces the custom Fetch and subscription/request controllers with one owner per concern; Axios adds a dependency and migration cost, but provides one place for transport defaults and error normalization. Protected feature API calls pass the token explicitly to the client, including `/auth/me` before the new session is published; public calls send no token. MapLibre owns rendering and interactions, not network state.
