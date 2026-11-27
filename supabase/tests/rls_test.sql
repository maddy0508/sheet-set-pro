-- Database test suite for Sheet Set Pro.
-- Runs against a real PostgreSQL instance with the local auth shim applied:
--   npm run test:db
-- Every assertion runs as a real role (anon / authenticated) with real JWT claims, so
-- the policies, triggers and constraints under test are the ones that ship.

\set ON_ERROR_STOP on

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'other@example.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'stranger@example.invalid')
on conflict (id) do nothing;

insert into public.businesses (id, display_name)
values ('00000000-0000-4000-8000-000000000002', 'Other Roofing (test)')
on conflict (id) do nothing;

insert into public.members (business_id, user_id, role)
values ('00000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'owner')
on conflict do nothing;

-- Anonymous -----------------------------------------------------------------
set role anon;
set request.jwt.claims = '{"role":"anon"}';

select tests.expect_error('anon cannot read customers', 'select * from public.customers', 'permission denied');
select tests.expect_error('anon cannot read jobs', 'select * from public.jobs', 'permission denied');
select tests.expect_error('anon cannot read invoices', 'select * from public.invoices', 'permission denied');
select tests.expect_error(
  'anon cannot insert a customer',
  $q$insert into public.customers (business_id, name) values ('00000000-0000-4000-8000-000000000001', 'Anon')$q$,
  'permission denied'
);
select tests.expect_error('anon cannot call workspace_status', 'select * from public.workspace_status()', 'permission denied');
select tests.expect_error(
  'anon cannot claim a workspace',
  $q$select public.claim_workspace('00000000-0000-4000-8000-000000000001')$q$,
  'permission denied'
);

reset role;

-- Onboarding: the first signed-in user claims the workspace ------------------
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select tests.expect_count(
  'an unclaimed workspace reports itself as unclaimed',
  $q$select 1 from public.workspace_status() where claimed = false and is_member = false$q$,
  1
);
select tests.expect_count(
  'the first authenticated user can claim the workspace',
  $q$select 1 from public.claim_workspace('00000000-0000-4000-8000-000000000001') as claimed where claimed$q$,
  1
);
select tests.expect_count(
  'claiming twice is harmless and keeps membership',
  $q$select 1 from public.claim_workspace('00000000-0000-4000-8000-000000000001') as claimed where claimed$q$,
  1
);
select tests.expect_count(
  'the member is recognised by workspace_status',
  $q$select 1 from public.workspace_status() where is_member$q$,
  1
);

-- Member CRUD ---------------------------------------------------------------
insert into public.customers (id, business_id, name, email, source_type)
values ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Alice Example', 'alice@example.invalid', 'TEST');

insert into public.jobs (id, business_id, customer_id, job_number, title, source_type, crs_epsg)
values ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'J-0001', 'Test roof', 'TEST', 7855);

insert into public.roof_planes (business_id, job_id, ref, x_mm, y_mm, width_mm, length_mm, pitch_microdeg)
values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'P1', 0, 0, 6000, 3600, 22500000);

insert into public.flashings (business_id, job_id, kind, length_mm)
values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'ridge', 6000);

insert into public.measurement_evidence (id, business_id, job_id, source_kind, note, accuracy_claim_mm, accuracy_basis, is_verified)
values ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'manual', 'Tape measure', 5, 'verified_by_test', true);

insert into public.measurements (id, business_id, job_id, evidence_id, kind, label, value_mm, tolerance_mm, grade)
values ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'control_dimension', 'Eave to ridge', 3600, 5, 'ORDER_GRADE');

update public.jobs set title = 'Test roof, revised' where id = 'bbbbbbbb-0000-4000-8000-000000000001';

select tests.expect_count('the member sees the customer it created', 'select 1 from public.customers', 1);
select tests.expect_count('the member sees the job it created', 'select 1 from public.jobs', 1);
select tests.expect_count(
  'the member sees planes, flashings, evidence and measurements',
  'select 1 from public.roof_planes union all select 1 from public.flashings union all select 1 from public.measurement_evidence union all select 1 from public.measurements',
  4
);
select tests.expect_count('the member can update its own job', $q$select 1 from public.jobs where title = 'Test roof, revised'$q$, 1);

-- Isolation between businesses ---------------------------------------------
select tests.expect_error(
  'a member cannot create a customer in another business',
  $q$insert into public.customers (business_id, name) values ('00000000-0000-4000-8000-000000000002', 'Trespass')$q$,
  'row-level security'
);
select tests.expect_error(
  'a member cannot move a job into another business',
  $q$update public.jobs set business_id = '00000000-0000-4000-8000-000000000002' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$,
  'row-level security'
);

-- Immutability: quotes ------------------------------------------------------
insert into public.quotes (id, business_id, job_id, number, revision, status, lines, totals, gst_applied, gst_rate_bp, issued_at, fingerprint)
values ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Q-0001', 1, 'issued',
        '[{"key":"sheet","description":"Sheet","qtyMicro":16000000,"unit":"ea","unitPriceCents":10869,"isPlaceholder":false}]'::jsonb,
        '{"subtotalCents":458544,"gstCents":0,"totalCents":458544}'::jsonb, false, 0, now(), 'fp-1');

select tests.expect_error(
  'an issued quote cannot have its lines changed',
  $q$update public.quotes set lines = '[]'::jsonb where id = 'eeeeeeee-0000-4000-8000-000000000001'$q$,
  'only its acceptance status may change'
);
select tests.expect_error(
  'an issued quote cannot have its total changed',
  $q$update public.quotes set totals = '{"subtotalCents":1,"gstCents":0,"totalCents":1}'::jsonb where id = 'eeeeeeee-0000-4000-8000-000000000001'$q$,
  'only its acceptance status may change'
);
select tests.expect_error(
  'an issued quote cannot be deleted',
  $q$delete from public.quotes where id = 'eeeeeeee-0000-4000-8000-000000000001'$q$,
  'cannot be deleted'
);

update public.quotes set status = 'accepted' where id = 'eeeeeeee-0000-4000-8000-000000000001';
select tests.expect_count('an issued quote can still be accepted', $q$select 1 from public.quotes where status = 'accepted'$q$, 1);

-- Immutability: invoices ----------------------------------------------------
insert into public.invoices (id, business_id, job_id, number, status, lines, totals, gst_rate_bp, issued_at, fingerprint)
values ('ffffffff-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'INV-0001', 'issued',
        '[{"key":"sheet","description":"Sheet","qtyMicro":16000000,"unit":"ea","unitPriceCents":10869,"isPlaceholder":false}]'::jsonb,
        '{"subtotalCents":458544,"gstCents":0,"totalCents":458544}'::jsonb, 0, now(), 'fp-inv-1');

select tests.expect_error(
  'an issued invoice cannot have its lines changed',
  $q$update public.invoices set lines = '[]'::jsonb where id = 'ffffffff-0000-4000-8000-000000000001'$q$,
  'cannot change'
);
select tests.expect_error(
  'an issued invoice cannot be deleted',
  $q$delete from public.invoices where id = 'ffffffff-0000-4000-8000-000000000001'$q$,
  'never deleted'
);

update public.invoices set status = 'voided', void_reason = 'Duplicate' where id = 'ffffffff-0000-4000-8000-000000000001';
select tests.expect_count(
  'an issued invoice can be voided with a reason',
  $q$select 1 from public.invoices where status = 'voided' and void_reason = 'Duplicate'$q$,
  1
);

-- Immutability: measurements and evidence -----------------------------------
select tests.expect_error(
  'a recorded measurement cannot have its value rewritten',
  $q$update public.measurements set value_mm = 9999 where id = 'dddddddd-0000-4000-8000-000000000001'$q$,
  'supersede it'
);
select tests.expect_error(
  'a measurement cannot be deleted',
  $q$delete from public.measurements where id = 'dddddddd-0000-4000-8000-000000000001'$q$,
  'never deleted'
);
select tests.expect_error(
  'evidence cannot be deleted',
  $q$delete from public.measurement_evidence where id = 'cccccccc-0000-4000-8000-000000000001'$q$,
  'never deleted'
);

update public.measurements set is_active = false where id = 'dddddddd-0000-4000-8000-000000000001';
select tests.expect_count('a measurement can be superseded', $q$select 1 from public.measurements where is_active = false$q$, 1);

select tests.expect_error(
  'a superseded measurement cannot be reactivated',
  $q$update public.measurements set is_active = true where id = 'dddddddd-0000-4000-8000-000000000001'$q$,
  'cannot be reactivated'
);

-- Immutability: money and history -------------------------------------------
insert into public.payments (id, business_id, job_id, amount_cents, received_at, method, reference, idempotency_key)
values ('99999999-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 100000, now(), 'bank_transfer', 'REF-1', 'idem-1');

select tests.expect_error(
  'a payment cannot be edited',
  $q$update public.payments set amount_cents = 1 where id = '99999999-0000-4000-8000-000000000001'$q$,
  'append-only'
);
select tests.expect_error(
  'a payment cannot be deleted',
  $q$delete from public.payments where id = '99999999-0000-4000-8000-000000000001'$q$,
  'append-only'
);
select tests.expect_error(
  'a repeated payment with the same idempotency key is rejected',
  $q$insert into public.payments (business_id, job_id, amount_cents, received_at, method, reference, idempotency_key) values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 100000, now(), 'bank_transfer', 'REF-1', 'idem-1')$q$,
  'duplicate key'
);

-- Money can only be applied to a live invoice, so INV-0001 (now voided) is not a
-- target; a second issued invoice carries the allocation below.
insert into public.invoices (id, business_id, job_id, number, status, lines, totals, gst_rate_bp, issued_at, fingerprint)
values ('ffffffff-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'INV-0002', 'issued', '[]'::jsonb,
        '{"subtotalCents":100000,"gstCents":0,"totalCents":100000}'::jsonb, 0, now(), 'fp-inv-2');

insert into public.payment_allocations (id, business_id, payment_id, invoice_id, amount_cents)
values ('88888888-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000002', 50000);

select tests.expect_error(
  'an allocation cannot be edited',
  $q$update public.payment_allocations set amount_cents = 1 where id = '88888888-0000-4000-8000-000000000001'$q$,
  'append-only'
);

insert into public.estimates (id, business_id, job_id, revision, lines, margin_bp, labour_cents, totals, fingerprint)
values ('77777777-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 1, '[]'::jsonb, 2500, 0, '{"subtotalCents":0,"gstCents":0,"totalCents":0}'::jsonb, 'fp-est-1');

select tests.expect_error(
  'an estimate revision cannot be rewritten',
  $q$update public.estimates set margin_bp = 1000 where id = '77777777-0000-4000-8000-000000000001'$q$,
  'immutable'
);
select tests.expect_error(
  'two estimates cannot share a revision number',
  $q$insert into public.estimates (business_id, job_id, revision, lines, margin_bp, totals, fingerprint) values ('00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 1, '[]'::jsonb, 2500, '{"subtotalCents":0,"gstCents":0,"totalCents":0}'::jsonb, 'fp-est-2')$q$,
  'duplicate key'
);

insert into public.calc_snapshots (id, business_id, job_id, input_fingerprint, output_fingerprint, engine_version, total_sheets, total_sheet_length_mm, area_mm2, blocking_issues, executed_in)
values ('66666666-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'in-1', 'out-1', 'engine-1', 16, 59200, 43200000, 0, 'client');

select tests.expect_error(
  'a calculation snapshot cannot be deleted',
  $q$delete from public.calc_snapshots where id = '66666666-0000-4000-8000-000000000001'$q$,
  'immutable'
);

insert into public.activity_events (id, business_id, type, subject_type, subject_id, detail)
values ('55555555-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'job.created', 'job', 'bbbbbbbb-0000-4000-8000-000000000001', 'Job created.');

select tests.expect_error(
  'the activity log cannot be rewritten',
  $q$update public.activity_events set detail = 'changed' where id = '55555555-0000-4000-8000-000000000001'$q$,
  'append-only'
);

-- A synthetic catalogue entry cannot pretend to be verified -----------------
select tests.expect_error(
  'a synthetic entry cannot claim to be verified',
  $q$insert into public.catalogue_profiles (id, business_id, manufacturer, name, material, verification_state, price_basis) values ('cat-bad', '00000000-0000-4000-8000-000000000001', 'Fake', 'Fake', 'Steel', 'VERIFIED', 'SYNTHETIC')$q$,
  'catalogue_unverified_source'
);

-- Labour cost is an optional internal cost basis ---------------------------
select tests.expect_count(
  'the labour cost basis starts unset, so profit is unknown rather than zero',
  $q$select 1 from public.businesses where id = '00000000-0000-4000-8000-000000000001' and labour_cost_cents_per_m2 is null$q$,
  1
);
update public.businesses set labour_cost_cents_per_m2 = 1800 where id = '00000000-0000-4000-8000-000000000001';
select tests.expect_count(
  'a member can record the labour cost basis',
  $q$select 1 from public.businesses where labour_cost_cents_per_m2 = 1800$q$,
  1
);
select tests.expect_error(
  'a negative labour cost is rejected',
  $q$update public.businesses set labour_cost_cents_per_m2 = -1 where id = '00000000-0000-4000-8000-000000000001'$q$,
  'violates check constraint'
);

reset role;

-- A different business sees only its own records ----------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select tests.expect_zero('another business sees none of the first business customers', 'select * from public.customers');
select tests.expect_zero('another business sees none of the first business jobs', 'select * from public.jobs');
select tests.expect_zero('another business sees none of the first business invoices', 'select * from public.invoices');
select tests.expect_zero('another business sees none of the first business payments', 'select * from public.payments');

insert into public.customers (business_id, name, source_type)
values ('00000000-0000-4000-8000-000000000002', 'Bob Example', 'TEST');
select tests.expect_count('another business can create its own customer', 'select 1 from public.customers', 1);

reset role;

-- A signed-in stranger with no membership -----------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select tests.expect_count(
  'a stranger can see that the workspace exists and is claimed',
  $q$select 1 from public.workspace_status() where claimed and not is_member$q$,
  1
);
select tests.expect_count(
  'a stranger cannot claim a workspace that already has an owner',
  $q$select 1 from public.claim_workspace('00000000-0000-4000-8000-000000000001') as claimed where not claimed$q$,
  1
);
select tests.expect_zero('a stranger sees no customers', 'select * from public.customers');
select tests.expect_zero('a stranger sees no jobs', 'select * from public.jobs');
select tests.expect_zero('a stranger sees no invoices', 'select * from public.invoices');
select tests.expect_error(
  'a stranger cannot create a customer',
  $q$insert into public.customers (business_id, name) values ('00000000-0000-4000-8000-000000000001', 'Uninvited')$q$,
  'row-level security'
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
  raise notice '% of % database assertions passed', v_total - v_failed, v_total;
  if v_failed > 0 then
    raise exception '% database assertions failed', v_failed;
  end if;
end
$$;
