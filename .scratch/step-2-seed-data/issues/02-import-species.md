# 02: Import species

**What to build:** A developer running the same startup or import command gets the supplied species master data before Sites and surveys are added. Repeated runs preserve existing values, and rejected source records remain visible in the host report.

**Blocked by:** 01: Import provinces on startup.

**Status:** resolved

- [x] The importer processes species after provinces from the supplied JSON array; only records with nonempty code, Thai name, and scientific name enter the existing species table.
- [x] The first valid occurrence of a source code wins; later source duplicates appear in the rejection report. Existing database codes are skipped without overwrite.
- [x] Malformed whole-file JSON or an unreadable file fails import and API startup, while invalid individual records are reported without preventing valid species import.
- [x] The command prints actual inserted, skipped-existing, and rejected counts for species; the host report records one-based source positions with escaped reasons, including on rerun.
- [x] Parser and import-backed tests prove validation, duplicate handling, report positions, and idempotency through observable output and stored species.
