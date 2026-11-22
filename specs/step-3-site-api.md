# Step 3 — Site API

**Project phase:** Step 3 — Site API. **Prerequisite:** Steps 1 and 2 completed and committed. **Commit prefix:** `step-3:`. **Status:** Implemented and verified; 36/36 isolated PostGIS tests passed, Swagger UI was browser-verified, and live API requests succeeded.

## Objective

Expose Site CRUD and spatial reads through the NestJS REST API, with consistent JSON errors and interactive OpenAPI/Swagger documentation at `/docs`. This Step does not add authentication or role-based authorization; those belong to Step 5.

## API contract

Coordinates in request and response GeoJSON use RFC 7946 order `[longitude, latitude]`. All successful reads exclude soft-deleted Sites. JSON errors have this shape:

```json
{"error":{"code":"INVALID_GEOMETRY","message":"Geometry is invalid","details":{}}}
```

`message` is human-readable; clients should branch on stable `code`. `details` is an object and may be empty.

A Site summary has exactly `code` (string), `name` (string), `province_code` (string), `area_rai` (number), and `version` (integer). List items are summaries without geometry. A Site Feature has `type: "Feature"`, a normalized MultiPolygon `geometry`, and summary fields in `properties`. POST and PATCH return that Feature; GET by code adds `latest_survey` to its properties. `latest_survey` is `null` when none exists, otherwise `{survey_ref: string|null, surveyed_on: "YYYY-MM-DD", cover_percent: number}`. GeoJSON FeatureCollection features sort by `code`.

Reject unknown request fields rather than silently accepting them. A malformed Feature, malformed JSON body, or invalid property value returns `400 VALIDATION_ERROR`; malformed, empty, or invalid Polygon/MultiPolygon geometry returns `400 INVALID_GEOMETRY`. Geometry with no positive-area Province intersection returns `422 OUTSIDE_COVERAGE` on both POST and geometry PATCH. The shared exception filter envelopes all errors: unknown routes use `404 NOT_FOUND`, and unexpected failures use `500 INTERNAL_ERROR` without exposing internal details.

| Method and path | Success | Error cases |
| --- | --- | --- |
| `GET /sites?province=&status=&q=&page=&pageSize=` | `200 {"items": [...], "total": n, "page": n}`. Items are Site summaries. Sort by `code`; page starts at 1, defaults to 1, page size defaults to 20 and has maximum 100. `q` is case-insensitive substring search over `code` and `name`. Omitted `status` or `status=active` selects active Sites; other values are invalid. | `400 VALIDATION_ERROR` for invalid query values. |
| `GET /sites.geojson?bbox=minLon,minLat,maxLon,maxLat&province=&status=` | `200` GeoJSON FeatureCollection containing active matching Sites intersecting the bbox, including boundary contact. Apply province/status filters as on `/sites`. `bbox` is required: four finite WGS84 numbers with `minLon < maxLon` and `minLat < maxLat`. | `400 INVALID_BBOX` for missing, malformed, out-of-range, zero-size, or inverted bounds; `400 VALIDATION_ERROR` for invalid other filters. |
| `GET /sites/:code` | `200` Site Feature with `latest_survey` (`null` or the summary above), selected by `surveyed_on DESC, id DESC`. | `404 SITE_NOT_FOUND` for missing or soft-deleted Sites. |
| `POST /sites` | Request is a GeoJSON Feature with only `type`, `properties: {code, name}`, and `geometry`. `201` returns the created Site Feature with server-derived `province_code`, `area_rai`, and `version: 1`. | `400 VALIDATION_ERROR`, `400 INVALID_GEOMETRY`, `409 DUPLICATE_CODE` (including soft-deleted codes), `422 OUTSIDE_COVERAGE`. |
| `PATCH /sites/:code` | Body requires positive integer `version` and at least one of `name` or `geometry` (GeoJSON geometry object); no other fields are editable. `200` returns the updated Site Feature with version incremented by one. | `400 VALIDATION_ERROR` (including attempts to change `code`, `province_code`, or `area_rai`), `400 INVALID_GEOMETRY`, `404 SITE_NOT_FOUND`, `409 VERSION_CONFLICT`, `409 SURVEYS_OUTSIDE`, `422 OUTSIDE_COVERAGE`. Soft-deleted Sites return `404`. |
| `DELETE /sites/:code` | `204`; soft-delete by setting `deleted_at`, preserving the row. | `404 SITE_NOT_FOUND` for missing or soft-deleted Sites; `409 SITE_HAS_SURVEYS` when any Surveys exist. |

## Requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S3-01 | Implement the six routes and successful response shapes in the API contract | REQUIRED |
| S3-02 | Every error response uses `{error:{code,message,details}}`; status and code match the contract | REQUIRED |
| S3-03 | Validate incoming GeoJSON as valid non-empty Polygon or MultiPolygon; reject invalid geometry without repair | REQUIRED; shared import policy |
| S3-04 | Require positive-area intersection with at least one Province; otherwise return `422 OUTSIDE_COVERAGE` | REQUIRED |
| S3-05 | Derive `province_code` from the Province with largest geographic intersection area; compute `area_rai = ROUND(ST_Area(geom::geography)/1600, 2)` on the server | REQUIRED; Step 2 rule |
| S3-06 | Reject client-supplied `province_code` and `area_rai`; never trust those values | REQUIRED |
| S3-07 | Site codes remain reserved after soft deletion; code is immutable after creation. A PATCH containing `code` returns `400 VALIDATION_ERROR`; enforce permanent uniqueness in a new migration without silently dropping historical records | REQUIRED |
| S3-08 | Search `q` case-insensitively across code and name; paginate from 1 with defaults and limits above; sort by code | REQUIRED |
| S3-09 | Validate bbox coordinate order, ranges, and min/max ordering; use PostGIS spatial intersection for selection | REQUIRED |
| S3-10 | DELETE is soft delete and is rejected when the Site has any Surveys | REQUIRED |
| S3-11 | Use NestJS `@nestjs/swagger` for Swagger UI at `/docs` and OpenAPI JSON at `/docs-json`, documenting routes, query/body schemas, success responses and common errors with the shared error schema | REQUIRED |
| S3-12 | Record the absence of an overlap ban and the Survey-preservation rule in `DESIGN.md` | REQUIRED |

## Validation and spatial behavior

- Accept GeoJSON `Polygon` and `MultiPolygon`, normalize Polygon to the database's `MultiPolygon` representation without repairing coordinates or topology.
- Check geometry validity in PostGIS (`ST_IsValid` / `ST_IsValidReason`); do not call `ST_MakeValid`.
- Enforce WGS84 longitude/latitude coordinate ranges and RFC 7946 axis order; do not silently swap coordinates.
- Coverage requires positive-area overlap with a Province; touching only a boundary is outside coverage. Resolve equal largest-overlap areas deterministically by province code, matching the importer.
- Recompute `province_code` and `area_rai` whenever geometry changes. Name-only changes do not need spatial recomputation.
- Do not reject positive-area overlap with other Sites; touching is also allowed, matching the import policy.
- A geometry edit must leave every linked Survey within 50 meters of the Site geometry (`ST_DWithin` on geography), matching the importer. Boundary points satisfy this rule; otherwise return `409 SURVEYS_OUTSIDE`.
- Use database transactions for create/update operations that combine geometry-derived values and persistence. PATCH atomically checks the supplied version and increments it; return `409 VERSION_CONFLICT` on a stale version.
- Serialize Site geometry edits and deletion with Survey insertion for the same Site, including the importer; otherwise concurrent imports can leave Surveys outside an edited Site or attach them to a deleted Site.

## Concurrency boundary

Step 3 implements the PATCH version check and conflict guarantee because its API contract requires them. Step 5 adds authentication and role-based authorization, not a deferred PATCH version guarantee.

## Tests and verification

- Controller/API tests cover every route's success status and response shape, common error envelope, documented failure status/code pairs, malformed JSON, unknown routes, and unexpected failures.
- Query tests cover defaults, page boundaries, maximum page size, deterministic ordering, case-insensitive search, and omission of geometry from list items.
- PostGIS integration tests cover Polygon and MultiPolygon creation, invalid geometry rejection without repair, outside-coverage rejection, largest-overlap province selection, computed rai rounding, and bbox intersection including boundary cases.
- Persistence tests cover duplicate reserved code (including deleted Sites), code immutability, geometry PATCH recomputation, soft delete, and rejection of deletion when Surveys exist.
- Contract checks confirm `/docs` loads the implemented API documentation, `/docs-json` returns its OpenAPI document, and both document the shared error schema.
- Test geometry edits against linked Surveys at the 50-meter boundary and beyond; existing Site overlap is allowed.
- Concurrent import and Site edit/delete tests preserve the Survey distance and soft-delete invariants; migration tests cover the permanent code constraint without deleting existing rows.

## Definition of done

- [x] Every listed endpoint responds with the specified success status and shape.
- [x] Every agreed failure case responds with the specified HTTP status and error code in the shared envelope.
- [x] Site geometry, coverage, province assignment, and area follow the validation rules above.
- [x] Listing, bbox, search, pagination, ordering, and geometry omission match the contract.
- [x] PATCH preserves immutable code, increments version atomically, and preserves the agreed Survey distance rule.
- [x] DELETE soft-deletes only Sites without Surveys.
- [x] `/docs` serves usable OpenAPI/Swagger documentation for the implemented API.
- [x] Automated tests pass; verified criteria are checked and any gaps remain unchecked.
- [x] Root README describes only the API features verified as implemented.

## Git instructions for this Step

Implement only Step 3. Verify the starting branch/worktree and completed prerequisite commits, run the API and PostGIS checks above, review the diff and source data, stage only Step 3 files, and commit the completed verified unit with the `step-3:` prefix. Do not begin Step 4 automatically.
