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

# psql reads the file through this shell, not through the postgres user, so the
# suite works when the checkout is somewhere that user cannot traverse.
run_sql() {
  "${PSQL[@]}" -d "$1" <"$2"
}

echo "Recreating database ${DB_NAME}…"
sudo -u postgres dropdb --if-exists "${DB_NAME}"
sudo -u postgres createdb "${DB_NAME}"

echo "Applying local auth shim…"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/local_bootstrap.sql" >/dev/null

for migration in "${ROOT}"/supabase/migrations/*.sql; do
  echo "Applying $(basename "${migration}")…"
  run_sql "${DB_NAME}" "${migration}" >/dev/null
done

echo "Creating test harness…"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/harness.sql" >/dev/null

echo "Running access-control and history suite…"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/rls_test.sql"

echo "Running commercial integrity suite…"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/commercial_integrity_test.sql"

echo "Running atomic save suite…"
run_sql "${DB_NAME}" "${ROOT}/supabase/tests/atomic_save_test.sql"

echo "Running allocation concurrency test…"
SSP_TEST_DB="${DB_NAME}" bash "${ROOT}/supabase/tests/allocation_concurrency_test.sh"

echo "Database suite passed."
