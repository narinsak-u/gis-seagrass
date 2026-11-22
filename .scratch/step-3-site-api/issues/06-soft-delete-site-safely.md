# 06: Soft-delete Sites without linked Surveys

**What to build:** Editors can retire a Survey-free Site without erasing its row or freeing its code. Sites with Surveys cannot be deleted, including when import races with the request.

**Blocked by:** 05: Edit Sites without overwriting versions or stranding Surveys.

**Status:** resolved

- [x] `DELETE /sites/:code` returns `204` with no body and sets the deletion timestamp while preserving the Site row and reserved code.
- [x] A Site with any linked Survey returns `409 SITE_HAS_SURVEYS` and remains active; missing, already deleted, and repeated deletions return `404 SITE_NOT_FOUND`.
- [x] Deleted Sites disappear from list, bbox, and detail reads; creating a new Site with the deleted code still returns `409 DUPLICATE_CODE`.
- [x] Deletion and Survey import serialize per Site so no new Survey can attach to a deleted Site, and no Site with a committed Survey is deleted.
- [x] Real HTTP/PostGIS and importer integration tests cover success, conflict, repeated deletion, retained data/code, read visibility, and concurrent insert/delete outcomes.

## Comments

Parent verification: build passed; 27 isolated API/PostGIS/import tests passed. Merged SHA: `a9bcd3d917cedeb7f9d8f654663c6849337b15f9`.
