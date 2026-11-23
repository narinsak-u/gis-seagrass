# 02: Move authentication into its module

**What to build:** Users can log in and access protected routes with the same roles and error behavior, while invalid inputs remain predictable.

**Blocked by:** 01: Add the Drizzle provider and AuthGuard pilot.

**Status:** resolved

- [ ] Login, token verification, active-user checks, role resolution, and development account seeding retain existing behavior and public contracts.
- [ ] A global transforming ValidationPipe rejects unknown fields, explicitly transforms query values, and does not coerce request-body values.
- [ ] Validation failures use the shared error envelope; malformed JSON remains parser-first, and guards run before DTO validation for parsed protected requests.
- [ ] HTTP tests cover login, role access, seeding, unknown fields, validation mapping, and error precedence; build and auth tests pass.
