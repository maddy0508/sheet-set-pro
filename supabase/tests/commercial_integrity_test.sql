-- Commercial integrity: payment allocation and issued-document snapshots.
-- Runs after rls_test.sql against the same database. Everything here is asserted as a real
-- signed-in member, so the policies, the allocation guard and the history triggers under
-- test are the ones that ship.

\set ON_ERROR_STOP on

truncate tests.results restart identity;

-- Fixtures ------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.customers (id, business_id, name)
values ('c1c1c1c1-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Allocation Customer');

insert into public.jobs (id, business_id, customer_id, job_number, title)
values
  ('d1d1d1d1-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001', 'J-1001', 'Allocation job one'),
  ('d2d2d2d2-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001', 'J-1002', 'Allocation job two');

insert into public.invoices (id, business_id, job_id, number, status, lines, totals, gst_rate_bp, issued_at, fingerprint)
values
  ('a1a1a1a1-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'INV-1001', 'issued', '[]'::jsonb,
   '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, now(), 'fp-1001'),
  ('a2a2a2a2-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'INV-1002', 'issued', '[]'::jsonb,
   '{"subtotalCents":800,"gstCents":0,"totalCents":800}'::jsonb, 0, now(), 'fp-1002'),
  ('a3a3a3a3-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'INV-1003', 'draft', '[]'::jsonb,
   '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, null, ''),
  ('a4a4a4a4-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'INV-1004', 'issued', '[]'::jsonb,
   '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, now(), 'fp-1004'),
  ('a5a5a5a5-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'd2d2d2d2-0000-4000-8000-000000000002', 'INV-1005', 'issued', '[]'::jsonb,
   '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, now(), 'fp-1005');

update public.invoices set status = 'voided', void_reason = 'Issued twice'
where id = 'a4a4a4a4-0000-4000-8000-000000000004';

insert into public.quotes (id, business_id, job_id, number, revision, status, lines, totals, fingerprint)
values ('e9e9e9e9-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001',
        'Q-1009', 1, 'draft', '[]'::jsonb, '{"subtotalCents":0,"gstCents":0,"totalCents":0}'::jsonb, '');

-- An issued document that does carry a snapshot, so removal can be attempted.
insert into public.quotes (id, business_id, job_id, number, revision, status, lines, totals, fingerprint, issued_at, snapshot)
values ('e8e8e8e8-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001',
        'Q-1008', 1, 'issued', '[]'::jsonb, '{"subtotalCents":0,"gstCents":0,"totalCents":0}'::jsonb, 'fp-1008', now(),
        '{"version":1,"number":"Q-1008","business":{"name":"Issued As","detail":[]}}'::jsonb);

insert into public.payments (id, business_id, job_id, amount_cents, received_at, method, reference, idempotency_key)
values
  ('b1b1b1b1-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 1000, now(), 'bank_transfer', 'R-1', 'alloc-1'),
  ('b2b2b2b2-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 1000, now(), 'bank_transfer', 'R-2', 'alloc-2'),
  ('b3b3b3b3-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 1000, now(), 'bank_transfer', 'R-3', 'alloc-3'),
  ('b4b4b4b4-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 1000, now(), 'bank_transfer', 'R-4', 'alloc-4'),
  ('b5b5b5b5-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 1000, now(), 'bank_transfer', 'R-5', 'alloc-5');

-- Allocation: a valid partial, then the payment remainder is a hard ceiling ----
insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
values ('00000000-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 600);

select tests.expect_count(
  'a valid partial allocation is accepted',
  $q$select 1 from public.payment_allocations where payment_id = 'b1b1b1b1-0000-4000-8000-000000000001' and amount_cents = 600$q$,
  1
);

select tests.expect_error(
  'an allocation beyond the payment remainder is rejected by the database',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 600)$q$,
  'unallocated on payment'
);

insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
values ('00000000-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 400);

select tests.expect_count(
  'a valid final allocation is accepted',
  $q$select sum(amount_cents) from public.payment_allocations where payment_id = 'b1b1b1b1-0000-4000-8000-000000000001'$q$,
  1
);
select tests.expect_count(
  'the payment is fully allocated and no further cents are accepted',
  $q$select 1 from public.payment_allocations where payment_id = 'b1b1b1b1-0000-4000-8000-000000000001' having sum(amount_cents) = 1000$q$,
  1
);
select tests.expect_error(
  'a fully allocated payment accepts nothing more',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000002', 1)$q$,
  'unallocated on payment'
);

-- Allocation: the invoice outstanding amount is a hard ceiling -----------------
insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
values ('00000000-0000-4000-8000-000000000001', 'b2b2b2b2-0000-4000-8000-000000000002', 'a2a2a2a2-0000-4000-8000-000000000002', 500);

select tests.expect_error(
  'an allocation beyond the invoice outstanding amount is rejected by the database',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b3b3b3b3-0000-4000-8000-000000000003', 'a2a2a2a2-0000-4000-8000-000000000002', 400)$q$,
  'outstanding on invoice'
);

insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents)
values ('00000000-0000-4000-8000-000000000001', 'b3b3b3b3-0000-4000-8000-000000000003', 'a2a2a2a2-0000-4000-8000-000000000002', 300);

select tests.expect_count(
  'the invoice is settled exactly to its total',
  $q$select 1 from public.payment_allocations where invoice_id = 'a2a2a2a2-0000-4000-8000-000000000002' having sum(amount_cents) = 800$q$,
  1
);

-- Allocation: only issued, live invoices --------------------------------------
select tests.expect_error(
  'a draft invoice cannot receive an allocation',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a3a3a3a3-0000-4000-8000-000000000003', 100)$q$,
  'only an issued invoice can receive an allocation'
);

select tests.expect_error(
  'a voided invoice cannot receive an allocation',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a4a4a4a4-0000-4000-8000-000000000004', 100)$q$,
  'only an issued invoice can receive an allocation'
);

-- Allocation: money does not move between jobs -------------------------------
select tests.expect_error(
  'an allocation cannot cross jobs',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a5a5a5a5-0000-4000-8000-000000000005', 100)$q$,
  'same job'
);

-- Allocation: amounts are positive whole cents -------------------------------
select tests.expect_error(
  'a zero-cent allocation is rejected',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a1a1a1a1-0000-4000-8000-000000000001', 0)$q$,
  'positive whole number of cents'
);
select tests.expect_error(
  'a negative allocation is rejected',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a1a1a1a1-0000-4000-8000-000000000001', -500)$q$,
  'positive whole number of cents'
);

reset role;

-- Allocation: money does not move between businesses -------------------------
insert into public.customers (id, business_id, name)
values ('c6c6c6c6-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', 'Other Business Customer')
on conflict (id) do nothing;

insert into public.jobs (id, business_id, customer_id, job_number, title)
values ('d6d6d6d6-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', 'c6c6c6c6-0000-4000-8000-000000000006', 'J-2001', 'Other business job')
on conflict (id) do nothing;

insert into public.invoices (id, business_id, job_id, number, status, lines, totals, gst_rate_bp, issued_at, fingerprint)
values ('a6a6a6a6-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', 'd6d6d6d6-0000-4000-8000-000000000006', 'INV-2001', 'issued', '[]'::jsonb,
        '{"subtotalCents":1000,"gstCents":0,"totalCents":1000}'::jsonb, 0, now(), 'fp-2001')
on conflict (id) do nothing;

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select tests.expect_error(
  'an allocation cannot cross businesses',
  $q$insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_cents) values ('00000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000004', 'a6a6a6a6-0000-4000-8000-000000000006', 100)$q$,
  'does not exist'
);

-- Issued documents: the snapshot is frozen ------------------------------------
update public.quotes
set snapshot = '{"version":1,"number":"Q-1009","business":{"name":"Issued As","detail":[]}}'::jsonb
where id = 'e9e9e9e9-0000-4000-8000-000000000009';

select tests.expect_count(
  'a draft quote can still have its snapshot written',
  $q$select 1 from public.quotes where id = 'e9e9e9e9-0000-4000-8000-000000000009' and snapshot is not null$q$,
  1
);

select tests.expect_error(
  'an issued quote snapshot cannot be replaced',
  $q$update public.quotes set snapshot = '{"version":1,"number":"Q-1008","business":{"name":"Rewritten","detail":[]}}'::jsonb where id = 'e8e8e8e8-0000-4000-8000-000000000008'$q$,
  'only its acceptance status may change'
);

select tests.expect_error(
  'an issued quote snapshot cannot be removed',
  $q$update public.quotes set snapshot = null where id = 'e8e8e8e8-0000-4000-8000-000000000008'$q$,
  'only its acceptance status may change'
);

select tests.expect_error(
  'an issued invoice snapshot cannot be replaced',
  $q$update public.invoices set snapshot = '{"version":1,"number":"INV-0001"}'::jsonb where id = 'ffffffff-0000-4000-8000-000000000001'$q$,
  'cannot change'
);

select tests.expect_error(
  'a snapshot must be an object, not an array',
  $q$update public.invoices set snapshot = '[]'::jsonb where id = 'a3a3a3a3-0000-4000-8000-000000000003'$q$,
  'invoices_snapshot_is_object'
);

-- Legacy documents: issued before snapshots existed, still readable ------------
select tests.expect_count(
  'an issued document without a snapshot is still a valid row',
  $q$select 1 from public.invoices where id = 'ffffffff-0000-4000-8000-000000000001' and snapshot is null$q$,
  1
);

reset role;

-- Report --------------------------------------------------------------------
\echo ''
select n, case when ok then 'PASS' else 'FAIL' end as result, name, detail
from tests.results
order by n;

do $$
declare
  v_total integer;
  v_failed integer;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_failed from tests.results;
  raise notice '% of % commercial integrity assertions passed', v_total - v_failed, v_total;
  if v_failed > 0 then
    raise exception '% commercial integrity assertions failed', v_failed;
  end if;
end
$$;
