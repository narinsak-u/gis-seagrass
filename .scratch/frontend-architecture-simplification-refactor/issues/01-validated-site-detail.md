# 01: Load validated public Site details

**What to build:** A visitor selects a Site and receives its current detail or a clear, retryable failure. Introduce the shared Axios transport and Zod response boundary through this one complete public flow; other Fetch-backed flows may coexist temporarily.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Selected Site detail loads from the unchanged same-origin gateway through the shared Axios client; no raw Axios response reaches the UI.
- [ ] Required Site fields, geometry coordinates, and Site status are validated; malformed success responses produce `INVALID_API_RESPONSE`, not an empty or `no_data` Site.
- [ ] Backend error codes and `ApiClientError` fields remain compatible; network failures, cancellation, timeout, and a bodyless 204 have the agreed normalized behavior.
- [ ] Existing detail loading, error, and retry behavior remains visible; focused API/Query tests cover endpoint, params, signal, and error cases without pinning internal function layout.
- [ ] The frontend remains green while unmigrated calls still use Fetch; only this completed flow needs Axios at this stage.
