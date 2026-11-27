#!/usr/bin/env bash
# Proves the database, not the browser, is the boundary between two simultaneous
# allocations. Two sessions each ask for 600 cents against a 1000 cent payment; the
# first holds its transaction open, the second must wait for the row lock and then be
# measured against the first — and be refused.
#
#   bash supabase/tests/allocation_concurrency_test.sh
#   SSP_TEST_DB=mydb bash supabase/tests/allocation_concurrency_test.sh
set -euo pipefail

DB_NAME="${SSP_TEST_DB:-sheet_set_pro_test}"
PSQL=(sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "${DB_NAME}")
CLAIMS='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}'
A_LOG="$(mktemp)"
B_LOG="$(mktemp)"
trap 'rm -f "${A_LOG}" "${B_LOG}"' EXIT

echo "Preparing a race between two allocations…"
"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.customers (id, business_id, name)
values ('c7c7c7c7-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'Race Customer');

insert into public.jobs (id, business_id, customer_id, job_number, title)
values ('d7d7d7d7-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001',
        'c7c7c7c7-0000-4000-8000-000000000007', 'J-7007', 'Race job');

insert into public.invoices (id, business_id, job_id, number, status, lines, totals, gst_rate_bp, issued_at, fingerprint)
values ('a7a7a7a7-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001',
        'd7d7d7d7-0000-4000-8000-000000000007', 'INV-7007', 'issued', '[]'::jsonb,
        '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, now(), 'fp-7007');

insert into public.payments (id, business_id, job_id, amount_cents, received_at, method, reference, idempotency_key)
values ('b7b7b7b7-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001',
        'd7d7d7d7-0000-4000-8000-000000000007', 1000, now(), 'bank_transfer', 'RACE-1', 'race-1');
SQL

# Session A: allocate 600, then hold the transaction open so its lock and its row are
# still uncommitted when session B asks for the same money.
(
  "${PSQL[@]}" -c "begin;
    set local role authenticated;
    set local request.jwt.claims = '${CLAIMS}';
    insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
    values ('00000000-0000-4000-8000-000000000001', 'b7b7b7b7-0000-4000-8000-000000000007', 'a7a7a7a7-0000-4000-8000-000000000007', 600);
    select pg_sleep(3);
    commit;" >"${A_LOG}" 2>&1
  echo $? >"${A_LOG}.rc"
) &
A_PID=$!

sleep 1

echo "Second session asks for another 600 cents while the first is uncommitted…"
set +e
"${PSQL[@]}" -c "begin;
  set local role authenticated;
  set local request.jwt.claims = '${CLAIMS}';
  insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
  values ('00000000-0000-4000-8000-000000000001', 'b7b7b7b7-0000-4000-8000-000000000007', 'a7a7a7a7-0000-4000-8000-000000000007', 600);
  commit;" >"${B_LOG}" 2>&1
B_RC=$?
set -e

wait "${A_PID}"
A_RC="$(cat "${A_LOG}.rc")"
rm -f "${A_LOG}.rc"

if [[ "${A_RC}" != "0" ]]; then
  echo "FAIL: the first allocation should have succeeded." >&2
  cat "${A_LOG}" >&2
  exit 1
fi

if [[ "${B_RC}" == "0" ]]; then
  echo "FAIL: the second allocation was accepted; the database allowed an over-allocation." >&2
  cat "${B_LOG}" >&2
  exit 1
fi

if ! grep -qi 'unallocated on payment' "${B_LOG}"; then
  echo "FAIL: the second allocation was refused for the wrong reason." >&2
  cat "${B_LOG}" >&2
  exit 1
fi

ALLOCATED="$("${PSQL[@]}" -At -c "select coalesce(sum(amount_cents), 0) from public.payment_allocations where payment_id = 'b7b7b7b7-0000-4000-8000-000000000007'")"
ROWS="$("${PSQL[@]}" -At -c "select count(*) from public.payment_allocations where payment_id = 'b7b7b7b7-0000-4000-8000-000000000007'")"

if [[ "${ALLOCATED}" != "600" || "${ROWS}" != "1" ]]; then
  echo "FAIL: expected one allocation of 600 cents, found ${ROWS} totalling ${ALLOCATED}." >&2
  exit 1
fi

echo "PASS: concurrent allocation refused by the database; payment holds one allocation of ${ALLOCATED} cents."
