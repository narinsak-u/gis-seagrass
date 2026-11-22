# Step 4 — Survey API

**Project phase:** Step 4 — Survey API. **Prerequisite:** Steps 1–3 completed and committed. **Commit prefix:** `step-4:`. **Status:** Ready for implementation.

## Objective

Expose Survey reads and writes for active Sites. Validate each observation, including its location against the Site using a distance measured in meters. Keep linked species records consistent, and ensure the Site status returned by the API reflects its Surveys immediately after a write.

This Step does not add authentication or role-based authorization; those belong to Step 5. Survey observation edits are in scope through PATCH; photo upload and photo editing are out of scope.

## API contract

Use the shared error envelope from Step 3:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Invalid request","details":{}}}
```

The Survey JSON representation is:

```json
{"id":"123","lon":99.35,"lat":7.38,"surveyed_on":"2026-10-01","cover_percent":45.5,"species":["EA","HO"],"note":"น้ำขุ่น"}
```

`id` is included on reads; write bodies do not accept it. `lon` and `lat` are WGS84 longitude and latitude, respectively. `species` is an array of species codes backed by `species.json` and the `survey_species` relation. `note` may be omitted or null. Do not expose internal `site_id`, geometry encoding, `survey_ref`, `photo_key`, or audit fields in this response unless the project contract is explicitly expanded.

The POST and PATCH responses add `siteStatus` as a top-level field beside the Survey fields. GET list items use only the Survey representation above.

All routes use only active Sites. A missing or soft-deleted Site on the list/create routes returns `404 SITE_NOT_FOUND`. Survey identifiers are canonical positive base-10 decimal strings representing database IDs; malformed IDs return `400 VALIDATION_ERROR`, while unknown IDs return `404 SURVEY_NOT_FOUND`. Reject unknown request fields.

| Method and path | Success | Error cases |
| --- | --- | --- |
| `GET /sites/:code/surveys?page=&pageSize=` | `200 {"items":[...],"total":n,"page":n}`. Each item has the Survey representation above. Sort by `surveyed_on DESC, id DESC`. Page starts at 1 and defaults to 1; page size defaults to 20 and has maximum 100, matching Step 3. | `400 VALIDATION_ERROR` for invalid query values; `404 SITE_NOT_FOUND`. |
| `POST /sites/:code/surveys` | `201` flat Survey representation plus top-level `siteStatus`. Require `lon`, `lat`, `surveyed_on`, `cover_percent`, and `species`; `note` is optional. | `400 VALIDATION_ERROR`; `404 SITE_NOT_FOUND`; `422 OUTSIDE_SITE`. |
| `PATCH /surveys/:id` | `200` flat updated Survey representation plus top-level `siteStatus`. Body includes only fields being changed and must contain at least one editable field. Supply `lon` and `lat` together. | `400 VALIDATION_ERROR`; `404 SURVEY_NOT_FOUND`; `422 OUTSIDE_SITE`. |
| `DELETE /surveys/:id` | `204`, permanently deletes the Survey and its species links. No response body. | `404 SURVEY_NOT_FOUND`. |

The listed success/error pairs are the minimum contract. The Step 3 shared exception filter still applies to unhandled routes and unexpected failures. `siteStatus` is one of `very_good`, `good`, `fair`, `poor`, or `no_data`, calculated by the rule below.

## Requirements

| ID | Requirement | Basis |
| --- | --- | --- |
| S4-01 | Implement the four routes and response statuses/shapes in the API contract | REQUIRED |
| S4-02 | Return the shared `{error:{code,message,details}}` envelope for errors | REQUIRED; Step 3 convention |
| S4-03 | Accept only `lon`, `lat`, `surveyed_on`, `cover_percent`, `species`, and `note` in write bodies; POST requires all except `note`; reject unknown keys and empty PATCH bodies | REQUIRED |
| S4-04 | Validate finite WGS84 coordinates and check the point is at most 50 meters from the linked active Site using PostGIS geography distance, inclusively | REQUIRED; Step 2 policy |
| S4-05 | Return `422 OUTSIDE_SITE` if the point is more than 50 meters from the Site | REQUIRED |
| S4-06 | Require `cover_percent` to be finite, within 0–100 inclusive, and representable at `numeric(5,2)` precision without rounding | REQUIRED; Step 1 schema and Step 2 importer |
| S4-07 | Require a strict valid `YYYY-MM-DD` `surveyed_on` no later than today in Thailand (`UTC+7`) | REQUIRED; Step 2 importer |
| S4-08 | Require every species code to exist in the species table; reject the whole request if any code is unknown and normalize duplicate codes to one association | REQUIRED; Step 2 importer |
| S4-09 | Store each Survey and its species associations atomically; on PATCH, replace associations only when `species` is supplied | REQUIRED |
| S4-10 | Return list Surveys in deterministic newest-first order by date then ID; paginate from 1 with Step 3 page-size defaults and bounds | REQUIRED |
| S4-11 | Derive Site status from all Surveys on the latest survey date; return it after create and update. DELETE remains `204` with no body, and derived status reflects deletion on subsequent calculation | REQUIRED |
| S4-12 | Coordinate Survey insertion/update with Site geometry edits and deletion so the Step 3 distance and active-Site invariants hold under concurrent writes | REQUIRED; Step 3 concurrency boundary |
| S4-13 | Update `/docs` and root README with only the verified Survey API contract and examples | REQUIRED; project convention |
| S4-14 | Add `siteStatus` beside the Survey fields in POST/PATCH responses; return `400 VALIDATION_ERROR` for malformed/non-positive IDs and `404 SURVEY_NOT_FOUND` for unknown valid IDs | REQUIRED |

## Validation and persistence behavior

- Parse longitude and latitude as finite numbers in their WGS84 ranges; do not swap axes or interpret degrees as distance.
- Persist Survey locations as `geometry(Point, 4326)`. Compare point-to-Site distance with `ST_DWithin(site.geom::geography, survey.geom::geography, 50)` or equivalent geography distance in meters. A point on the boundary or exactly 50 meters away passes; 200 meters away fails with `422 OUTSIDE_SITE`.
- On create, resolve an active Site by `code`. On PATCH, the Survey's Site association is immutable; the request cannot move a Survey to another Site. PATCH of a Survey linked to a soft-deleted Site returns `404 SURVEY_NOT_FOUND`; Step 3 prevents soft-deleting Sites that have Surveys.
- Require `surveyed_on` to be a real calendar date in exact `YYYY-MM-DD` form and not after the current Thailand date. Do not depend on the database/server local timezone.
- Require `cover_percent` between 0 and 100 inclusive and validate that it is representable at `numeric(5,2)` precision; reject excess precision rather than silently rounding.
- `species` must be an array of known string codes. POST requires the field; empty arrays are permitted. Normalize duplicate entries to one link per species, matching importer behavior. Persist links in `survey_species`, not a JSON/array column.
- Omitted `note` on POST stores null. On PATCH, omitted fields remain unchanged; explicit `note: null` clears the note. `note` has no additional length or whitespace-normalization rule.
- Run each create/update/delete and its species-link changes in a transaction. Lock the linked Site row with `SELECT ... FOR UPDATE` to serialize with Site geometry edits/deletion and importer writes. PATCH is partial; this Step does not require optimistic locking because Survey versioning is not in the supplied schema/contract. When either coordinate changes in PATCH, require both `lon` and `lat`.
- On DELETE, remove the Survey's `survey_species` links and Survey row atomically. The schema uses restrictive foreign keys, so delete associations before the parent row in the same transaction. This is a hard delete as required by the `204` contract.
- Derive Site status from current Survey rows rather than storing a cached value. Include the derived status in POST/PATCH responses. DELETE returns `204` without a body; deletion changes the result of the next status calculation without a separate status write.

## Site status rule

Find the maximum `surveyed_on` for the Site, then average `cover_percent` across **all** its Surveys on that date. Map that average to the status values below. Surveys on earlier dates do not affect the status. With no Surveys, status is `no_data`.

| Mean cover on latest date | Status |
| --- | --- |
| `>= 75` | `very_good` |
| `>= 50` and `< 75` | `good` |
| `>= 25` and `< 50` | `fair` |
| `< 25` | `poor` |
| No Surveys | `no_data` |

All Surveys sharing the latest date contribute to the mean; do not select only the row with the highest ID. Recompute after a Survey create, update, or delete, so changing the last Survey on the latest date may move the Site status to an earlier date's result or to `no_data`. POST/PATCH return the resulting status; DELETE has no response body.

## Tests and verification

- Controller/API tests cover all route success statuses and response shapes, unknown fields, malformed JSON, malformed/non-positive Survey IDs, and the shared error envelope.
- Validation tests cover missing/invalid fields, non-finite and out-of-range coordinates, lone-coordinate PATCH rejection, cover values below 0 and above 100, excess numeric precision, strict dates, Bangkok midnight boundaries, unknown species, empty species arrays, duplicate normalization, and PATCH omitted-versus-null semantics.
- PostGIS integration tests cover points inside/on the boundary, 30 meters away (accepted), exactly 50 meters away (accepted), and beyond 50 meters including 200 meters (`422 OUTSIDE_SITE`). Use geographic distance in meters.
- Persistence tests cover active/missing/soft-deleted Sites, unknown Survey IDs, atomic Survey/species writes, species replacement on PATCH, note clearing, hard delete, and no orphan species links.
- Query tests cover pagination defaults/bounds, deterministic newest-first ordering including equal dates, and list shape.
- Status tests cover no Surveys; values exactly at 25, 50, and 75; values below each threshold; multiple Surveys on the latest date; exclusion of older Surveys; and create, update, and delete recomputation. A newly added Survey with cover 20% on a date newer than all existing Surveys makes the status `poor` immediately.
- Concurrency tests cover Survey writes racing Site geometry edits/deletion and prove no committed point violates the 50-meter invariant.
- Verify Swagger documents the actual request and response schemas and errors. Update README only after implementation is verified.

## Definition of done

- [ ] Site status uses the mean cover of all Surveys on the latest date and the approved thresholds, including `no_data` for Sites without Surveys.
- [ ] Every listed route responds with the specified success status and shape.
- [ ] Every agreed failure case responds with the specified HTTP status and error code in the shared envelope.
- [ ] Survey fields, species links, Bangkok date, and 50-meter geography validation match the contract.
- [ ] Site status reflects create and update mutations in their responses and reflects deletion on the next calculation.
- [ ] Concurrent Survey and Site writes preserve the spatial and active-Site invariants.
- [ ] `/docs` documents the implemented Survey API.
- [ ] Automated checks pass; verified criteria are checked and gaps remain unchecked.
- [ ] Root README describes only verified API features.

## Git instructions for this Step

Implement only Step 4. Verify the starting branch/worktree and completed prerequisite commits, run the API and PostGIS checks above, review the diff and source data, stage only Step 4 files, and commit the completed verified unit with the `step-4:` prefix. Do not begin Step 5 automatically.
