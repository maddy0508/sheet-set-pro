#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway PostgreSQL database and runs the
# access-control and history-protection suite against it.
#
#   bash scripts/test-db.sh            # local throwaway database
#   SSP_TEST_DB=mydb bash scripts/test-db.sh
#
# The local auth shim stands in for Supabase's auth schema; a real project already has it.
set -euo pipefail

DB_NAME="${SSP_TEST_DB:-sheet_set_pro_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1)

echo "Recreating database ${DB_NAME}…"
sudo -u postgres dropdb --if-exists "${DB_NAME}"
sudo -u postgres createdb "${DB_NAME}"

echo "Applying local auth shim…"
"${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT}/supabase/tests/local_bootstrap.sql" >/dev/null

for migration in "${ROOT}"/supabase/migrations/*.sql; do
  echo "Applying $(basename "${migration}")…"
  "${PSQL[@]}" -d "${DB_NAME}" -f "${migration}" >/dev/null
done

echo "Creating test harness…"
"${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT}/supabase/tests/harness.sql" >/dev/null

echo "Running access-control and history suite…"
"${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT}/supabase/tests/rls_test.sql"

echo "Running commercial integrity suite…"
"${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT}/supabase/tests/commercial_integrity_test.sql"

echo "Running allocation concurrency test…"
SSP_TEST_DB="${DB_NAME}" bash "${ROOT}/supabase/tests/allocation_concurrency_test.sh"

echo "Database suite passed."
