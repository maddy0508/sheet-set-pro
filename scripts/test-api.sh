#!/usr/bin/env bash
# End-to-end check of the persistence layer against a real PostgREST instance talking
# to a real PostgreSQL database with the shipped migrations and RLS policies applied.
#
# It exercises the same module the browser uses (src/data/remote.ts): claim the
# workspace, write records, read them back, and try to break the history rules.
#
#   bash scripts/test-api.sh
#   SSP_API_DB=other_db bash scripts/test-api.sh
#
# It recreates its database, so it defaults to a scratch name rather than the
# development database that scripts/dev-api.sh keeps serving.
set -euo pipefail

DB_NAME="${SSP_API_DB:-ssp_api_test}"
PORT="${SSP_API_PORT:-3111}"
UPSTREAM_PORT="$((PORT + 1))"
JWT_SECRET="${SSP_API_JWT_SECRET:-local-development-secret-at-least-32-chars}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1)

# psql reads the file through this shell, not through the postgres user, so the
# suite works when the checkout is somewhere that user cannot traverse.
run_sql() {
  "${PSQL[@]}" -d "$1" <"$2"
}

POSTGREST_BIN="${SSP_POSTGREST_BIN:-/tmp/postgrest}"
if [[ ! -x "${POSTGREST_BIN}" ]]; then
  echo "Fetching PostgREST 12.2.3…"
  curl -sL -o /tmp/postgrest.tar.xz \
    https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xf /tmp/postgrest.tar.xz -C /tmp
  POSTGREST_BIN=/tmp/postgrest
fi

echo "Recreating database ${DB_NAME}…"
sudo -u postgres dropdb --if-exists "${DB_NAME}"
sudo -u postgres createdb "${DB_NAME}"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/local_bootstrap.sql" >/dev/null
for migration in "${ROOT}"/supabase/migrations/*.sql; do
  run_sql "${DB_NAME}" "${migration}" >/dev/null
done

echo "Preparing the API role…"
"${PSQL[@]}" -d "${DB_NAME}" >/dev/null <<'SQL'
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authenticator-local' noinherit;
  end if;
end
$do$;
grant anon, authenticated to authenticator;
grant usage on schema public to anon, authenticated;
SQL

echo "Minting an access token for the owner…"
TOKEN="$(JWT_SECRET="${JWT_SECRET}" node -e '
const crypto = require("node:crypto");
const secret = process.env.JWT_SECRET;
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const header = enc({ alg: "HS256", typ: "JWT" });
const payload = enc({
  sub: "11111111-1111-4111-8111-111111111111",
  role: "authenticated",
  aud: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
});
const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${sig}`);
')"

echo "Starting PostgREST on port ${UPSTREAM_PORT}…"
PGRST_DB_URI="postgres://authenticator:authenticator-local@127.0.0.1:5432/${DB_NAME}" \
PGRST_DB_SCHEMAS="public" \
PGRST_DB_ANON_ROLE="anon" \
PGRST_JWT_SECRET="${JWT_SECRET}" \
PGRST_SERVER_PORT="${UPSTREAM_PORT}" \
PGRST_LOG_LEVEL="error" \
  "${POSTGREST_BIN}" >/tmp/ssp-postgrest.log 2>&1 &
API_PID=$!

echo "Starting the /rest/v1 proxy on port ${PORT}…"
node "${ROOT}/scripts/postgrest-proxy.mjs" "${PORT}" "${UPSTREAM_PORT}" &
PROXY_PID=$!
trap 'kill "${API_PID}" "${PROXY_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/rest/v1/"; then break; fi
  sleep 0.25
done

if ! curl -s -o /dev/null "http://127.0.0.1:${PORT}/rest/v1/"; then
  echo "PostgREST did not start:" >&2
  cat /tmp/ssp-postgrest.log >&2
  exit 1
fi

echo "Running the integration suite…"
cd "${ROOT}"
SSP_API_URL="http://127.0.0.1:${PORT}" \
VITE_SUPABASE_URL="http://127.0.0.1:${PORT}" \
VITE_SUPABASE_PUBLISHABLE_KEY="${TOKEN}" \
SSP_API_JWT_SECRET="${JWT_SECRET}" \
  npx vitest run src/data/remote.integration.test.ts

echo "API integration suite passed."
