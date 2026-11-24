#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
project="gis-seagrass-e2e-$(id -u)-$$"
export E2E_DB_VOLUME="${project}-db"
export E2E_GATEWAY_PORT="${E2E_GATEWAY_PORT:-18080}"
export E2E_REPORT_DIR="$repo_root/frontend/test-results/compose-report"
run_token="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
export E2E_VIEWER_EMAIL="viewer-${project}@example.test"
export E2E_EDITOR_EMAIL="editor-${project}@example.test"
export E2E_ADMIN_EMAIL="admin-${project}@example.test"
export E2E_VIEWER_PASSWORD="${run_token}-viewer"
export E2E_EDITOR_PASSWORD="${run_token}-editor"
export E2E_ADMIN_PASSWORD="${run_token}-admin"
mkdir -p "$E2E_REPORT_DIR"

compose=(docker compose --project-name "$project" \
  -f "$repo_root/docker-compose.yml" \
  -f "$repo_root/docker-compose.e2e.yml")
cleanup() {
  local status=$?
  "${compose[@]}" down --volumes --remove-orphans || status=$?
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose[@]}" up --build --wait --detach

"${compose[@]}" exec -T \
  -e E2E_VIEWER_EMAIL -e E2E_VIEWER_PASSWORD \
  -e E2E_EDITOR_EMAIL -e E2E_EDITOR_PASSWORD \
  -e E2E_ADMIN_EMAIL -e E2E_ADMIN_PASSWORD \
  api node -e '
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { hashPassword } = require("./dist/auth/application/auth-token.js");
const client = new Client();
(async () => {
  await client.connect();
  try {
    for (const role of ["viewer", "editor", "admin"]) {
      const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`];
      const password = process.env[`E2E_${role.toUpperCase()}_PASSWORD`];
      await client.query(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        [randomUUID(), email, await hashPassword(password), role],
      );
    }
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'

PLAYWRIGHT_BASE_URL="http://127.0.0.1:$E2E_GATEWAY_PORT" \
  npx playwright test
