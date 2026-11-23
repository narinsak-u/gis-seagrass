# 05: Move protected Survey reads

**What to build:** Signed-in viewers, editors, and admins can read paginated Survey records and identify each API-created Survey's creator.

**Blocked by:** 02: Move authentication into its module; 03: Move public Site reads and status.

**Status:** resolved

- [ ] Active viewer, editor, and admin tokens can read Survey pages; anonymous, invalid, inactive, or deleted-user tokens receive the existing unauthorized response.
- [ ] Current roles are resolved per request, and authorization precedes Site lookup for protected requests.
- [ ] Survey list fields, order, and pagination remain unchanged except for nullable `created_by`; imported Surveys remain null and secrets stay private.
- [ ] Real HTTP/PostGIS tests cover role access, missing Sites, creator projection, and pagination; OpenAPI remains accurate.
