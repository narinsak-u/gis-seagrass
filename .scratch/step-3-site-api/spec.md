Status: ready-for-agent

## Problem Statement

A user cannot list, inspect, search, create, change, or retire monitored Sites through the API. Spatial map clients cannot fetch Sites within a bounding box. Invalid Site geometry, historical codes, and linked Surveys need consistent treatment; clients also lack predictable JSON errors and usable API documentation.

## Solution

Expose six Site routes with GeoJSON reads and writes, active-only listing, spatial selection, server-derived geography, optimistic PATCH version checks, Survey-preserving edits, and soft deletion. Return one stable JSON error envelope and publish interactive OpenAPI documentation. Keep the existing import policy and data model coherent with API writes; do not add authentication before its planned step.

## User Stories

1. As an API consumer, I want to list active Sites, so that I can discover monitored areas.
2. As an API consumer, I want list items without geometry, so that normal browsing does not transfer polygon data.
3. As an API consumer, I want Site summaries with code, name, province code, area in rai, and version, so that I can display identity and derived facts.
4. As an API consumer, I want results ordered by Site code, so that pagination is deterministic.
5. As an API consumer, I want a total count and current page, so that I can render pagination controls.
6. As an API consumer, I want pages numbered from one with a default size of 20, so that omitted options behave predictably.
7. As an API consumer, I want page size capped at 100, so that one request cannot demand an unbounded list page.
8. As an API consumer, I want case-insensitive substring search across Site code and name, so that partial matches are discoverable.
9. As an API consumer, I want to filter Site lists by province, so that I can focus on one region.
10. As an API consumer, I want omitted status or `active` to select only active Sites, so that historical Sites do not appear unexpectedly.
11. As an API consumer, I want unsupported status values rejected, so that I cannot mistake an ignored filter for a valid one.
12. As a map client, I want GeoJSON Features intersecting my requested bounding box, so that I can draw visible Sites.
13. As a map client, I want Site boundary contact to count as bbox intersection, so that edge features do not disappear.
14. As a map client, I want bbox results ordered by code and filterable by province, so that map and list views remain predictable.
15. As a map client, I want missing, malformed, out-of-range, zero-size, or inverted bounds rejected, so that bad viewports do not trigger unintended reads.
16. As an API consumer, I want to fetch an active Site by code as a GeoJSON Feature, so that I can inspect its geometry and attributes.
17. As an API consumer, I want the latest linked Survey summarized by reference, date, and cover percent, so that I can see the latest observation without loading every Survey.
18. As an API consumer, I want a missing Survey represented as null, so that absence is unambiguous.
19. As an API consumer, I want equal-date Surveys resolved by the later database identity, so that latest is deterministic.
20. As an API consumer, I want a soft-deleted Site to return `SITE_NOT_FOUND` on lookup, edit, or delete, so that retired records stay hidden.
21. As an editor, I want to create a Site from a GeoJSON Feature, so that I can add a monitored area.
22. As an editor, I want valid Polygon and MultiPolygon inputs accepted and stored as MultiPolygon, so that shape representation remains consistent.
23. As a data steward, I want malformed, empty, self-intersecting, or out-of-range geometry rejected without repair or coordinate swapping, so that invalid geography cannot silently enter the system.
24. As a data steward, I want new or edited geometry to overlap a Province by positive area, so that mere boundary contact cannot establish coverage.
25. As a data steward, I want province assignment based on greatest geographic overlap, with code breaking ties, so that assignments match import behavior.
26. As an analyst, I want Site area calculated on the server in rai and rounded to two decimals, so that clients cannot supply inconsistent measurements.
27. As a data steward, I want supplied province and area fields rejected, so that the server remains authoritative.
28. As a data steward, I want historical Site codes reserved after soft deletion, so that a new Site cannot impersonate a retired one.
29. As an editor, I want to change a Site name or geometry without changing its code, so that references remain stable.
30. As an editor, I want a name-only update to keep the derived geometry values, so that it does no needless spatial recalculation.
31. As an editor, I want geometry updates to recompute province and area, so that Site attributes remain consistent.
32. As an editor, I want a required version on PATCH and a version conflict for stale edits, so that concurrent changes cannot silently overwrite one another.
33. As a data steward, I want linked Surveys to remain inside or within 50 meters of an edited Site, so that past observations remain associated with valid Site geography.
34. As a data steward, I want an edit rejected with `SURVEYS_OUTSIDE` when it strands a linked Survey, so that the historical relationship remains meaningful.
35. As an editor, I want overlapping Sites allowed, so that valid existing import geography is not prohibited by a new API rule.
36. As an editor, I want to soft-delete a Site with no Surveys, so that it disappears from reads without losing its historical row or code.
37. As a data steward, I want deletion rejected when any linked Surveys exist, so that their Site cannot be retired through this route.
38. As a data steward, I want concurrent Survey imports and Site edits/deletion serialized, so that valid checks do not become false before commit.
39. As an API consumer, I want each failure to include a stable error code, human-readable message, and object details, so that clients can react predictably.
40. As an API consumer, I want malformed input, duplicate codes, geometry errors, coverage errors, missing Sites, and version conflicts to have distinct statuses and codes, so that I can correct the right problem.
41. As an API consumer, I want unexpected errors to hide internal details, so that failures do not leak implementation or database information.
42. As a developer, I want interactive Swagger UI and an OpenAPI JSON document, so that I can explore and generate clients for the implemented API.
43. As a developer, I want the docs to show body/query schemas, success shapes, and shared errors, so that the contract matches real responses.
44. As a developer, I want a root README with verified API features, commands, limitations, and request examples, so that I can try the documented routes without guessing at payloads.

## Implementation Decisions

- Implement six routes: paginated Site list, bbox GeoJSON collection, Site detail by code, create, partial update, and soft delete. Successful status codes are 200 for reads and PATCH, 201 for POST, and 204 for DELETE.
- Return only active Sites. `status` accepts only omission or `active` on both list routes; invalid query values return `400 VALIDATION_ERROR`. Missing or deleted code lookups, PATCH, and DELETE return `404 SITE_NOT_FOUND`.
- List summaries contain exactly `code`, `name`, `province_code`, `area_rai`, and `version`; the last two are JSON numbers. List response contains `items`, `total`, and `page`. Sort by code, start at page one, default to 20 items, cap page size at 100, and search code or name with case-insensitive substring matching.
- Site Features use GeoJSON `type: Feature`, a MultiPolygon `geometry`, and summary fields in `properties`. Only detail adds `latest_survey`: null or `{survey_ref, surveyed_on, cover_percent}`. Preserve null Survey references, use `YYYY-MM-DD` dates and numeric cover, and order Survey selection by date descending then identity descending.
- The spatial collection uses a required `bbox=minLon,minLat,maxLon,maxLat`. Require four finite WGS84 coordinates within longitude/latitude ranges and strictly increasing axes; reject invalid bounds with `400 INVALID_BBOX`. Use PostGIS intersection, including boundary contact. Apply list province/status filtering and order Features by code.
- POST accepts only a GeoJSON Feature with `properties` containing code and name and a Polygon or MultiPolygon geometry. PATCH accepts a positive integer version and at least one of name or GeoJSON geometry; code and derived fields are immutable. Reject unknown input fields and bad property values with `400 VALIDATION_ERROR`.
- Apply existing coordinate-shape checks, PostGIS validity and nonempty checks without topology repair, coordinate swapping, or trusted client-derived values. Reject invalid geometry with `400 INVALID_GEOMETRY` on POST and geometry PATCH; require positive Province intersection area or return `422 OUTSIDE_COVERAGE`.
- Choose the Province with largest geographic intersection area, breaking ties by Province code. Compute area from geography in square meters divided by 1600, rounded to two decimals. Recompute derived values only on geometry changes; start new Sites at version 1.
- Site codes remain reserved after soft deletion. Replace the active-only database uniqueness rule with permanent uniqueness via a new migration; never silently discard historical duplicates. Return `409 DUPLICATE_CODE` for any existing code, including a deleted Site.
- Allow positive-area Site overlaps and boundary contact, consistent with the importer. Do not implement `SITE_OVERLAP` rejection.
- A geometry PATCH must preserve every linked Survey inside or within 50 meters of the changed Site geometry using PostGIS geography distance; return `409 SURVEYS_OUTSIDE` otherwise. Boundary Survey points pass.
- Run derived geometry work and persistence in database transactions. Atomically compare and increment PATCH version; stale versions return `409 VERSION_CONFLICT`. Serialize Site edits/deletion with Survey insertion for that Site, including the existing importer, to preserve the distance and deletion guarantees under races.
- DELETE sets the deletion timestamp but preserves the row and reserved code; reject any linked Survey with `409 SITE_HAS_SURVEYS`. Repeated deletion finds no active Site and returns `404 SITE_NOT_FOUND`.
- Envelop every error as `{error:{code,message,details}}`, with details always an object. Malformed JSON and invalid fields use `400 VALIDATION_ERROR`; unknown routes use `404 NOT_FOUND`; unexpected failures use `500 INTERNAL_ERROR` without leaking internals. Document per-route codes and statuses.
- Use NestJS OpenAPI integration to serve Swagger UI at `/docs` and OpenAPI JSON at `/docs-json`. Document query and request schemas, success shapes, and shared error schema.
- Keep shared geometry semantics in backend service/domain code rather than a cross-application package. Record overlap allowance and Survey preservation in design documentation; update root README with only verified behavior and working API request examples. Commit the verified Step with the `step-3:` prefix. Do not start the next Step automatically.

## Testing Decisions

- A good test checks a public HTTP result, a persisted PostGIS invariant, or an actual documentation endpoint. It must catch a plausible client-visible defect, not assert wiring, source text, or internal helper calls.
- Primary seam: send real HTTP requests to the NestJS API against an isolated PostGIS fixture database, then inspect public responses and affected rows. Use the existing Node test runner and database-backed fixture pattern; do not add a mocked-controller test seam.
- Reuse the existing importer integration seam for concurrent Survey insertion against Site PATCH/DELETE. Verify serialization and final persisted invariants rather than assuming one race ordering.
- Exercise all six route success statuses and exact response shapes, numeric serialization, GeoJSON coordinate order, geometry omission from lists, detail Survey absence and same-date tie-break, and soft-deleted visibility.
- Cover pagination defaults, first and later pages, page-size maximum, stable code order, mixed-case substring search, province filter, and invalid `status`/query values.
- Cover bbox missing/invalid/range/zero-size/inverted cases, inside and boundary-touching features, province filtering, ordering, and active-only selection.
- Cover valid Polygon and MultiPolygon creation, invalid self-intersection and empty shapes, out-of-range coordinates, no Province coverage, boundary-only Province contact, greatest geographic overlap, deterministic tie, and numeric rai rounding.
- Cover strict POST/PATCH field validation, immutable code, derived-field rejection, reserved deleted codes, PATCH recomputation, stale version conflict, unchanged name-only geography, and preservation/rejection of Surveys at the 50-meter threshold.
- Cover DELETE with and without Surveys, repeated deletion, and import/Edit/Delete races with real database transactions. Test the new uniqueness migration against preexisting records without erasing them.
- Verify every documented error status/code and shared envelope, including malformed JSON, unknown routes, and unexpected failures without leaked internals.
- Fetch OpenAPI JSON and check route, schema, response, and shared-error declarations. Open Swagger UI in a browser to confirm it serves a usable page.
- Prior art: the existing Site and Survey importer tests use Node `node:test`, strict assertions, random unique fixture identities, and an isolated PostGIS database supplied by the integration-test URL. Extend that pattern for API-level checks, not the production or development database.

## Out of Scope

- Authentication, JWT, role-based authorization, and user credentials; those belong to Step 5. This Step's write routes remain unauthenticated.
- Survey CRUD, survey status, map UI, map editing, dashboard, exports, production hardening, and later Step work.
- Historic Site restoration, exposing deleted Sites through public filters, overlap bans, geometry repair, automatic coordinate swaps, and unbounded GeoJSON reads.
- New services, a root npm workspace, a cross-application shared package, and dependencies unrelated to the required OpenAPI integration.

## Further Notes

- Steps 1 and 2 are committed. The existing database has only an active-code unique index, while the Site importer already reserves deleted codes; Step 3 closes that constraint gap. Existing Survey import accepts points inside or up to 50 meters from a Site, so strict containment would break its policy.
- The agreed Step 3 implementation spec remains the authoritative endpoint and Definition-of-done checklist. Its implementation boxes are unchecked; this issue specifies work, not proof of completion.
- The primary HTTP/PostGIS test seam and reuse of the importer seam for races were confirmed with the user. Publish only this Step; do not begin Step 4 automatically.
