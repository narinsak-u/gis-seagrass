# 01: Login and development accounts

**What to build:** People can log in with email and password and receive a short-lived token. The development stack supplies usable viewer, editor, and admin accounts only when explicitly enabled, without resetting existing accounts or shipping known credentials into deployment.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `POST /auth/login` accepts exactly email and password strings; valid active users receive `200` with a signed Bearer JWT and `expires_in: 900`. Wrong email and wrong password return the same `401 UNAUTHORIZED` envelope; malformed requests return `400 VALIDATION_ERROR`.
- [x] Tokens expire within 15 minutes. Invalid signatures and expired tokens cannot be accepted. Passwords are stored as salted hashes, never plaintext, and no response reveals a password hash or signing secret.
- [x] A user-active flag defaults true for existing users; an inactive user cannot log in. The migration and schema leave existing Site and Survey records valid.
- [x] API startup fails without an explicitly configured JWT signing secret. Development-only example configuration supports Compose startup; deployment secrets must be overridden and are not published in API responses.
- [x] The explicit development-account flag inserts one account per viewer, editor, and admin role only when enabled; disabled startup inserts none. Repeated startup does not overwrite existing passwords, roles, or inactive flags. Do not use `NODE_ENV` to infer development mode.
- [x] Root README documents the required development environment setup and usable local credentials; Swagger documents login requests, success, and errors. Existing integration tests remain executable with an isolated test signing secret.
- [x] Real HTTP/PostGIS tests prove login and seeded account behavior; a separate startup check proves the missing-secret failure. No test touches an existing development database.
