#!/usr/bin/env bash
# Runs a local Supabase-shaped backend and keeps it up, so the built application can be
# pointed at a real HTTP API instead of the device.
#
# It starts PostgreSQL (with the shipped migrations and RLS), PostgREST and the /rest/v1
# proxy, then writes .env.local-api with the URL and a signed-in operator token.
#
#   bash scripts/dev-api.sh            # start on port 3111
#   SSP_API_PORT=3200 bash scripts/dev-api.sh
#
# Stop it with Ctrl-C; the database is left in place for inspection with psql.
set -euo pipefail

DB_NAME="${SSP_API_DB:-sheet_set_pro_api}"
PORT="${SSP_API_PORT:-3111}"
UPSTREAM_PORT="$((PORT + 1))"
JWT_SECRET="${SSP_API_JWT_SECRET:-local-development-secret-at-least-32-chars}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1)

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
"${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT}/supabase/tests/local_bootstrap.sql" >/dev/null
for migration in "${ROOT}"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "${DB_NAME}" -f "${migration}" >/dev/null
done

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

TOKEN="$(JWT_SECRET="${JWT_SECRET}" node -e '
const crypto = require("node:crypto");
const secret = process.env.JWT_SECRET;
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const header = enc({ alg: "HS256", typ: "JWT" });
const payload = enc({
  sub: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.invalid",
  role: "authenticated",
  aud: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 8 * 3600,
});
const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${sig}`);
')"

PGRST_DB_URI="postgres://authenticator:authenticator-local@127.0.0.1:5432/${DB_NAME}" \
PGRST_DB_SCHEMAS="public" \
PGRST_DB_ANON_ROLE="anon" \
PGRST_JWT_SECRET="${JWT_SECRET}" \
PGRST_SERVER_PORT="${UPSTREAM_PORT}" \
PGRST_LOG_LEVEL="error" \
  "${POSTGREST_BIN}" >/tmp/ssp-postgrest.log 2>&1 &
API_PID=$!

node "${ROOT}/scripts/postgrest-proxy.mjs" "${PORT}" "${UPSTREAM_PORT}" 0.0.0.0 &
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

cat > "${ROOT}/.env.local-api" <<ENV
# Written by scripts/dev-api.sh. Local backend for development only; not a Supabase project.
VITE_SUPABASE_URL=http://127.0.0.1:${PORT}
VITE_SUPABASE_PUBLISHABLE_KEY=${TOKEN}
ENV

echo "Backend ready."
echo "  database   ${DB_NAME} (psql: sudo -u postgres psql ${DB_NAME})"
echo "  API        http://127.0.0.1:${PORT}/rest/v1"
echo "  env file   .env.local-api (URL and an 8-hour operator token)"
echo "Build against it with:  set -a; . ./.env.local-api; set +a; npm run build"
echo "Press Ctrl-C to stop."

wait "${API_PID}"
