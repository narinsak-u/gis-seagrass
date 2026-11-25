# 03: Consolidate only equivalent validation

Status: resolved
Blocked by: None

**What to build:** Compare `backend/src/sites/presentation/sites.dto.ts`, `sites.controller.ts`, `backend/src/surveys/presentation/surveys.dto.ts`, `surveys.validation.ts`, `backend/src/sites/domain/site-feature.ts`, and `backend/src/auth/presentation/login-body-parser.middleware.ts`. Remove duplicate checks only when the same inputs receive the same acceptance, status, code, and error envelope.

- [x] DTOs retain ordinary Survey field type/range checks; `parseSurveyInput` retains cross-field coordinates, strict calendar dates, precision from `rawBody`, species normalization, unknown fields, empty PATCH, and note handling. Site feature parsing and login parser exception remain unchanged.
- [x] Reused the existing Site parser for API/Import without changes; preserved `INVALID_GEOMETRY`, `VALIDATION_ERROR`, importer reasons, and numeric literals rounded by JavaScript.
- [x] Removed only Survey parser field checks already enforced by the controller DTO pipe. Kept authorization order, `note: null`, request formats, and strict decimals unchanged.
- [x] Verified backend build/test typecheck and two focused Survey integration files (9 tests), then the combined isolated PostGIS suite (25 files, 81 tests). Existing HTTP tests cover the changed validation boundary; no additional test needed.

## Comments

Validation cleanup committed as `00927551c8`. `parseSurveyInput` is called only from DTO-bound Survey controller methods in this repository; callers bypassing those DTOs are outside its supported HTTP seam.
