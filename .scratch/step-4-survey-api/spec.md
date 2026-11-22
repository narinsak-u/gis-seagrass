Status: ready-for-agent

## Problem Statement

API consumers cannot read, create, update, or delete Surveys through the service. Survey observations need consistent validation against their Site, including a meter-based geographic distance rule. Species associations and the Site status derived from Surveys must remain correct during writes and concurrent Site changes.

## Solution

Expose four Survey API routes: list a Site's Surveys, create a Survey for an active Site, partially update a Survey without changing its Site, and permanently delete a Survey. Validate coordinates, date, cover, and species; persist Survey rows and species links atomically; return the resulting Site status after create or update. Derive status from current Surveys, and coordinate writes with Site geometry edits and deletion.

## User Stories

1. As an API consumer, I want to list Surveys for an active Site, so that I can inspect its observations.
2. As an API consumer, I want a missing or soft-deleted Site to return `SITE_NOT_FOUND`, so that inactive Sites do not appear to have accessible Surveys.
3. As an API consumer, I want Survey list pages numbered from one, so that pagination is predictable.
4. As an API consumer, I want list pages to default to 20 items and cap at 100, so that responses stay bounded.
5. As an API consumer, I want to select `pageSize`, so that I can choose a supported page length.
6. As an API consumer, I want Survey lists ordered by date descending and ID descending, so that pagination remains deterministic when dates match.
7. As an API consumer, I want Survey IDs serialized as decimal strings, so that database identities do not lose precision in JSON clients.
8. As an API consumer, I want Survey responses to expose only public observation fields, so that database IDs, geometry encoding, audit data, photo keys, and import references remain internal.
9. As an editor, I want to create a Survey with location, date, cover, and species, so that a new observation is complete and linked to known species.
10. As an editor, I want an optional note to default to null, so that I can submit observations without notes.
11. As a data steward, I want coordinates validated as finite WGS84 longitude and latitude, so that malformed points cannot enter the system.
12. As a data steward, I want a Survey point no more than 50 meters from its Site, measured with PostGIS geography, so that the rule uses meters rather than degrees.
13. As a data steward, I want points exactly 50 meters away accepted and farther points rejected, so that the distance boundary is inclusive and consistent with import policy.
14. As a data steward, I want cover percentages restricted to 0–100 and representable at two decimal places, so that stored values match the database precision without silent rounding.
15. As a data steward, I want survey dates to be real `YYYY-MM-DD` dates no later than today's date in Thailand, so that dates do not depend on server timezone.
16. As a data steward, I want every species code checked against the species table, so that invalid associations reject the whole write.
17. As an editor, I want duplicate species codes normalized to one association and an empty species array permitted, so that requests match existing importer behavior and can represent no species.
18. As an editor, I want each Survey and its species links saved atomically, so that failed writes leave no partial records.
19. As an editor, I want to PATCH only supplied fields, so that omitted values remain unchanged.
20. As an editor, I want PATCH to replace species links only when `species` is supplied, so that unrelated updates preserve associations.
21. As an editor, I want PATCH to require both longitude and latitude when either changes, so that a point cannot be rebuilt from incomplete coordinates.
22. As a data steward, I want a Survey's Site association immutable, so that PATCH cannot move an observation between Sites.
23. As an editor, I want `note: null` to clear a note while omitted `note` preserves it, so that partial updates distinguish clearing from omission.
24. As an API consumer, I want malformed or non-positive Survey IDs rejected with `VALIDATION_ERROR` and unknown valid IDs reported as `SURVEY_NOT_FOUND`, so that invalid input differs from missing data.
25. As an API consumer, I want create and update responses to include the Survey fields and top-level `siteStatus`, so that I immediately see the affected Site's current state.
26. As an analyst, I want Site status based on the mean cover of every Survey on the latest survey date, so that same-date observations contribute together and older dates do not affect the result.
27. As an analyst, I want status thresholds at 25, 50, and 75 percent and `no_data` for Sites without Surveys, so that status has stable boundaries.
28. As an API consumer, I want DELETE to return `204` without a response body, so that the hard-delete contract remains unambiguous.
29. As a data steward, I want Survey deletion to remove species links and the Survey atomically, so that restrictive foreign keys leave no orphan links.
30. As a data steward, I want status derived from current Survey rows, so that a deletion cannot leave a stale cached status.
31. As a data steward, I want Survey writes serialized with Site geometry edits and deletion, so that no committed Survey violates the active-Site or 50-meter invariants under races.
32. As an API consumer, I want all errors returned in the shared error envelope, so that clients can handle failures consistently.
33. As a developer, I want Swagger and the root README to describe only verified Survey API behavior, so that examples match the implementation.

## Implementation Decisions

- Implement `GET /sites/:code/surveys`, `POST /sites/:code/surveys`, `PATCH /surveys/:id`, and `DELETE /surveys/:id`.
- The list response is `{items, total, page}`. `page` defaults to 1; `pageSize` defaults to 20 and has maximum 100. Sort by `surveyed_on DESC, id DESC`.
- Survey representations contain `id`, `lon`, `lat`, `surveyed_on`, `cover_percent`, `species`, and `note`. IDs are canonical positive base-10 decimal strings. Do not expose `site_id`, geometry encoding, `survey_ref`, `photo_key`, or audit fields.
- POST requires `lon`, `lat`, `surveyed_on`, `cover_percent`, and `species`; `note` is optional and defaults to null. Empty species arrays are allowed. Duplicate species codes normalize to one association.
- PATCH requires at least one editable field, accepts only supplied fields, and does not allow changing Site association. If either coordinate is supplied, both are required. Omitted fields remain unchanged; `note: null` clears the note. Species links are replaced only when `species` is supplied.
- Reject unknown body fields. Malformed/non-positive IDs return `400 VALIDATION_ERROR`; unknown valid IDs return `404 SURVEY_NOT_FOUND`. Missing or soft-deleted Sites on list/create return `404 SITE_NOT_FOUND`. PATCH of a Survey attached to a soft-deleted Site returns `404 SURVEY_NOT_FOUND`; Step 3 prevents soft-deleting a Site with Surveys.
- Validate finite WGS84 coordinates in longitude/latitude order. Store locations as `geometry(Point, 4326)`. Use PostGIS geography distance inclusively at 50 meters; farther points return `422 OUTSIDE_SITE`.
- Validate cover as finite, within 0–100 inclusive, and representable at `numeric(5,2)` precision without rounding. Validate an exact real calendar date in `YYYY-MM-DD` form, no later than the current Thailand date (`UTC+7`).
- Every species code must exist. Reject the entire request for unknown codes. Keep species associations in the relation table.
- Run each create, update, and delete with its species-link changes in one transaction. Lock the linked Site row with `FOR UPDATE`, matching the importer and Site API concurrency boundary. Coordinate the same lock with geometry edits and deletion.
- Derive status from all Surveys on the maximum survey date, averaging every Survey on that date. Thresholds: `>=75` very_good, `>=50` good, `>=25` fair, `<25` poor, and `no_data` with no Surveys.
- POST and PATCH return the flat Survey representation plus top-level `siteStatus`. DELETE remains `204` without a body. Status is derived from current rows, not cached; deletion therefore changes the result of the next calculation without a status write.
- Hard-delete Survey species links and the Survey in one transaction. Authentication, role authorization, photo upload, and photo editing are out of scope.
- Use the shared `{error:{code,message,details}}` envelope. Update Swagger and README only to document verified behavior.

## Testing Decisions

- Tests must prove public HTTP behavior, persisted data, spatial invariants, or documented OpenAPI behavior. Avoid tests that only assert wiring, internal helper calls, source text, or incidental defaults.
- Primary seam: send real HTTP requests to the NestJS API against an isolated PostGIS database; assert responses and persisted rows. The user approved this seam.
- Use the existing Node integration-test and database-fixture pattern. Extend the highest existing API/PostGIS seam rather than adding mocked-controller tests.
- Test all route statuses/shapes, validation errors and envelopes, unknown fields, malformed JSON, ID validation, pagination defaults/bounds/order, species persistence and replacement, note clearing, hard delete, and absence of orphan links.
- Test coordinate boundaries, including 30 meters, exactly 50 meters, and beyond 50 meters; test date validity and Bangkok midnight, cover boundaries and excess precision, and unknown/duplicate/empty species arrays.
- Test status thresholds, no-data, multiple Surveys on the latest date, exclusion of older dates, and create/update/delete recomputation.
- Test real concurrent Survey writes against Site geometry edits/deletion and assert final persisted invariants without assuming race order.
- Verify Swagger documents actual request/response schemas and errors. Update README only after implementation verification.
- Prior art: the Site API and Survey importer use Node's test runner, real HTTP/PostGIS integration, isolated database fixtures, and persisted-state assertions.

## Out of Scope

- Authentication, JWT, and role-based authorization; those belong to the next planned step.
- Photo upload or photo editing.
- Site CRUD, map UI, map editing, dashboard, exports, and production hardening.
- Survey versioning or optimistic locking; the supplied Survey schema has no version field.
- Caching Site status or adding a separate status persistence column.

## Further Notes

- The existing Step 4 implementation specification remains the source of detailed acceptance criteria. Its status formula and 50-meter rule align with existing import and Site geometry policies.
- A `204` DELETE cannot return a status body. The agreed contract keeps `204`; status is derived from current Survey rows and returned on create/update only.
- The test seam was confirmed before publication. Publish only the Survey API work; do not begin the following step automatically.
