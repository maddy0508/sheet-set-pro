#!/usr/bin/env bash
# Restore drill: prove a backup restores to a database that holds the same records,
# satisfies the commercial invariants, and is served correctly through PostgREST.
#
#   bash scripts/restore-drill.sh                  # latest backup in the backup directory
#   bash scripts/restore-drill.sh path/to/file.dump
#   KEEP=1 bash scripts/restore-drill.sh           # leave the scratch database behind
#
# Prints PASS or FAIL. A drill that cannot run reports FAIL, never PASS.
set -euo pipefail

LIVE_DB="${SSP_API_DB:-sheet_set_pro_api}"
DRILL_DB="${SSP_DRILL_DB:-ssp_restore_drill}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SSP_BACKUP_DIR:-$REPO_ROOT/.backups}"
PORT="${SSP_DRILL_PORT:-3211}"
UPSTREAM_PORT="$((PORT + 1))"
JWT_SECRET="${SSP_API_JWT_SECRET:-local-development-secret-at-least-32-chars}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1)

DUMP="${1:-}"
if [[ -z "${DUMP}" ]]; then
  DUMP="$(ls -1t "${BACKUP_DIR}"/*.dump 2>/dev/null | head -1 || true)"
fi
if [[ -z "${DUMP}" || ! -f "${DUMP}" ]]; then
  echo "FAIL: no backup archive found in ${BACKUP_DIR}." >&2
  exit 1
fi

fail() { echo "FAIL: $*" >&2; exit 1; }
cleanup() {
  kill -9 "${API_PID:-}" "${PROXY_PID:-}" 2>/dev/null || true
  wait "${API_PID:-}" 2>/dev/null || true
  if [[ "${KEEP:-0}" != "1" ]]; then
    sudo -u postgres dropdb --if-exists "${DRILL_DB}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Drill source: ${DUMP}"
if [[ -f "${DUMP}.sha256" ]]; then
  (cd "$(dirname "${DUMP}")" && sha256sum -c "$(basename "${DUMP}").sha256") >/dev/null \
    || fail "archive checksum does not match its sidecar"
  echo "Checksum: matches sidecar."
else
  echo "Checksum: no sidecar, skipped."
fi

echo "Restoring into ${DRILL_DB}…"
sudo -u postgres dropdb --if-exists "${DRILL_DB}"
sudo -u postgres createdb "${DRILL_DB}"
# The archive is opened by this shell (owned by the operator) and handed to
# pg_restore as stdin, so the postgres role never needs read access to the file.
sudo -u postgres pg_restore --no-owner --dbname "${DRILL_DB}" <"${DUMP}" \
  || fail "pg_restore reported errors"

echo "Comparing every table against ${LIVE_DB}…"
fingerprint() {
  local db="$1"
  "${PSQL[@]}" -d "${db}" -Atc "
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name" | while read -r table; do
    "${PSQL[@]}" -d "${db}" -Atc "
      select '${table}:' || count(*) || ':' ||
             md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
        from public.\"${table}\" t" </dev/null
  done
}

fingerprint "${LIVE_DB}" >/tmp/ssp-drill-live.txt
fingerprint "${DRILL_DB}" >/tmp/ssp-drill-restored.txt

if ! diff -u /tmp/ssp-drill-live.txt /tmp/ssp-drill-restored.txt; then
  fail "restored rows differ from the live database"
fi
echo "Rows: $(wc -l </tmp/ssp-drill-live.txt) tables identical, content checksums match."

echo "Checking commercial invariants in the restored copy…"
violations="$("${PSQL[@]}" -d "${DRILL_DB}" -At <<'SQL'
select 'invoice ' || i.number || ' is allocated beyond its total'
  from invoices i
  left join payment_allocations a on a.invoice_id = i.id
 where i.status <> 'voided'
 group by i.id, i.number, i.totals
having coalesce(sum(a.amount_cents), 0) > (i.totals->>'totalCents')::bigint;
select 'payment ' || p.id || ' is allocated beyond its amount'
  from payments p
  left join payment_allocations a on a.payment_id = p.id
 group by p.id, p.amount_cents
having coalesce(sum(a.amount_cents), 0) > p.amount_cents;
select 'a ' || src || ' ' || number || ' carries no fingerprint'
  from (
    select 'quote' as src, number, fingerprint from quotes
     where status in ('issued', 'accepted', 'declined')
    union all
    select 'invoice' as src, number, fingerprint from invoices where status = 'issued'
  ) t where coalesce(fingerprint, '') = '';
SQL
)" || fail "the invariant query did not run"
[[ -z "${violations}" ]] || fail "${violations}"
echo "Invariants: allocations bounded by payment and invoice, issued documents fingerprinted."

echo "Serving the restored copy through PostgREST on port ${UPSTREAM_PORT}…"
POSTGREST_BIN="${SSP_POSTGREST_BIN:-/tmp/postgrest}"
[[ -x "${POSTGREST_BIN}" ]] || fail "PostgREST binary not found at ${POSTGREST_BIN}"

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

PGRST_DB_URI="postgres://authenticator:authenticator-local@127.0.0.1:5432/${DRILL_DB}" \
PGRST_DB_SCHEMAS="public" \
PGRST_DB_ANON_ROLE="anon" \
PGRST_JWT_SECRET="${JWT_SECRET}" \
PGRST_SERVER_PORT="${UPSTREAM_PORT}" \
PGRST_LOG_LEVEL="error" \
  setsid "${POSTGREST_BIN}" >/tmp/ssp-drill-postgrest.log 2>&1 &
API_PID=$!
disown "${API_PID}" 2>/dev/null || true

for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:${UPSTREAM_PORT}/" && break
  sleep 0.25
done
curl -s -o /dev/null "http://127.0.0.1:${UPSTREAM_PORT}/" \
  || { cat /tmp/ssp-drill-postgrest.log >&2; fail "PostgREST did not start on the restored copy"; }

AUTH_HEADERS=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json")

# The root path answers before the schema cache is ready, so wait for a real read.
ready=""
for _ in $(seq 1 40); do
  ready="$(curl -s "${AUTH_HEADERS[@]}" "http://127.0.0.1:${UPSTREAM_PORT}/invoices?select=number")"
  [[ "${ready}" == \[* ]] && break
  sleep 0.25
done
[[ "${ready}" == \[* ]] || fail "the restored copy is not readable through the API: ${ready}"

allocations="$(curl -s "${AUTH_HEADERS[@]}" "http://127.0.0.1:${UPSTREAM_PORT}/payment_allocations?select=amount_cents")"
[[ "${allocations}" == \[* ]] || fail "the owner cannot read allocations from the restored copy"
echo "API: allocations readable by the owner — ${allocations}"

invoices="$(curl -s "${AUTH_HEADERS[@]}" "http://127.0.0.1:${UPSTREAM_PORT}/invoices?select=number,status,totals")"
[[ "${invoices}" == \[* ]] || fail "the owner cannot read invoices from the restored copy"
echo "API: invoices readable by the owner — ${invoices}"

anon_status="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Accept: application/json" "http://127.0.0.1:${UPSTREAM_PORT}/invoices?select=id")"
if [[ "${anon_status}" != "401" && "${anon_status}" != "200" ]]; then
  fail "unexpected anonymous response (${anon_status})"
fi
if [[ "${anon_status}" == "200" ]]; then
  anon_body="$(curl -s -H "Accept: application/json" "http://127.0.0.1:${UPSTREAM_PORT}/invoices?select=id")"
  [[ "${anon_body}" == "[]" ]] || fail "an anonymous caller can read invoice rows"
  echo "API: anonymous read returns an empty set (RLS enforced)."
else
  echo "API: anonymous read refused (${anon_status})."
fi

echo "PASS: ${DUMP} restores to an identical, invariant-holding database served correctly through the API."
