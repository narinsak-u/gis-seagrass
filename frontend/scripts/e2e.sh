#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
project="gis-seagrass-e2e-$(id -u)-$$"
export E2E_DB_VOLUME="${project}-db"
export E2E_GATEWAY_PORT="${E2E_GATEWAY_PORT:-18080}"
export E2E_REPORT_DIR="$repo_root/frontend/test-results/compose-report"
export JWT_SECRET="step9-e2e-only-signing-secret-never-use-in-deployments"
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
PLAYWRIGHT_BASE_URL="http://127.0.0.1:$E2E_GATEWAY_PORT" \
  npx playwright test
