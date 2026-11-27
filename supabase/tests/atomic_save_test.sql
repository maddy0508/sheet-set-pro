-- Atomic workspace saves: one save is one transaction.
-- Runs after rls_test.sql and commercial_integrity_test.sql against the same database,
-- as a real signed-in member, so the policies and triggers under test are the ones that
-- ship. Every failure case asserts that the tables the save had already touched are back
-- exactly where they were.

\set ON_ERROR_STOP on

truncate tests.results restart identity;

-- The write path has to stay the caller's own: no elevated privilege to leak.
select tests.record(
  'the save function runs as the caller, not as its owner',
  (select not prosecdef from pg_proc where proname = 'save_workspace'),
  coalesce((select case when prosecdef then 'security definer' else 'security invoker' end
            from pg_proc where proname = 'save_workspace'), 'function missing')
);

select tests.record(
  'anonymous callers cannot execute the save function',
  not has_function_privilege('anon', 'public.save_workspace(uuid, jsonb, jsonb, jsonb)', 'execute'),
  'anon execute privilege'
);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- A save that should succeed ------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  v_result := public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    '{"id":"00000000-0000-4000-8000-000000000001","display_name":"Atomic Test Roofing","abn":"12345678901"}'::jsonb,
    $j${
      "customers": [{
        "id": "c0000000-0000-4000-8000-000000000001",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "name": "Atomic Customer",
        "contact_name": "", "email": "", "phone": "", "address": "", "notes": "",
        "source_type": "TEST",
        "created_at": "2026-11-27T00:00:00.000Z",
        "updated_at": "2026-11-27T00:00:00.000Z"
      }],
      "jobs": [{
        "id": "d0000000-0000-4000-8000-000000000001",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "customer_id": "c0000000-0000-4000-8000-000000000001",
        "job_number": "J-3001",
        "title": "Atomic job",
        "site_address": "",
        "status": "draft",
        "notes": "",
        "source_type": "TEST",
        "profile_id": null, "crs_epsg": null, "operator_approved": false,
        "created_at": "2026-11-27T00:00:00.000Z",
        "updated_at": "2026-11-27T00:00:00.000Z"
      }],
      "roof_planes": [{
        "id": "e0000000-0000-4000-8000-000000000001",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "job_id": "d0000000-0000-4000-8000-000000000001",
        "ref": "P1", "x_mm": 0, "y_mm": 0,
        "width_mm": 6000, "length_mm": 3600, "pitch_microdeg": 22500000
      }],
      "flashings": [{
        "id": "f0000000-0000-4000-8000-000000000001",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "job_id": "d0000000-0000-4000-8000-000000000001",
        "kind": "ridge", "length_mm": 12000, "source": "ENTERED"
      }]
    }$j$::jsonb,
    '{}'::jsonb
  );

  perform tests.record(
    'a successful save reports what it wrote',
    v_result -> 'upserted' ->> 'customers' = '1'
      and v_result -> 'upserted' ->> 'jobs' = '1'
      and v_result -> 'upserted' ->> 'roof_planes' = '1'
      and v_result -> 'upserted' ->> 'flashings' = '1',
    v_result::text
  );
end
$$;

select tests.expect_count(
  'a successful save writes the business settings',
  $q$select 1 from public.businesses
      where id = '00000000-0000-4000-8000-000000000001'
        and display_name = 'Atomic Test Roofing' and abn = '12345678901'$q$,
  1
);

select tests.expect_count(
  'a successful save writes the customer, job, plane and flashing',
  $q$select 1
       from public.customers c
       join public.jobs j on j.customer_id = c.id
       join public.roof_planes p on p.job_id = j.id
       join public.flashings f on f.job_id = j.id
      where c.id = 'c0000000-0000-4000-8000-000000000001'
        and j.id = 'd0000000-0000-4000-8000-000000000001'
        and p.id = 'e0000000-0000-4000-8000-000000000001'
        and f.id = 'f0000000-0000-4000-8000-000000000001'$q$,
  1
);

select tests.expect_count(
  'a record written without an ord column still gets one',
  $q$select 1 from public.roof_planes where id = 'e0000000-0000-4000-8000-000000000001' and ord is not null$q$,
  1
);

select tests.expect_count(
  'a record written without created_at still gets one',
  $q$select 1 from public.roof_planes where id = 'e0000000-0000-4000-8000-000000000001' and created_at is not null$q$,
  1
);

-- A rejection late in the save undoes everything before it ------------------
select tests.expect_error(
  'a rejected measurement rolls back the customer, job and evidence written first',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    $j${
      "customers": [{
        "id": "c0000000-0000-4000-8000-000000000002",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "name": "Rolled Back Customer", "contact_name": "", "email": "", "phone": "",
        "address": "", "notes": "", "source_type": "TEST",
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }],
      "jobs": [{
        "id": "d0000000-0000-4000-8000-000000000002",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "customer_id": "c0000000-0000-4000-8000-000000000002",
        "job_number": "J-3002", "title": "Rolled back job", "site_address": "",
        "status": "draft", "notes": "", "source_type": "TEST",
        "profile_id": null, "crs_epsg": null, "operator_approved": false,
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }],
      "measurement_evidence": [{
        "id": "a0000000-0000-4000-8000-000000000002",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "job_id": "d0000000-0000-4000-8000-000000000002",
        "source_kind": "manual", "note": "should not survive",
        "accuracy_claim_mm": 5, "accuracy_basis": "operator_estimate", "is_verified": false,
        "created_at": "2026-11-27T00:00:00.000Z"
      }],
      "measurements": [{
        "id": "b0000000-0000-4000-8000-000000000002",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "job_id": "d0000000-0000-4000-8000-000000000002",
        "evidence_id": "a0000000-0000-4000-8000-000000000002",
        "kind": "control_dimension", "label": "Impossible", "value_mm": 0,
        "tolerance_mm": 5, "grade": "ESTIMATE_GRADE", "is_active": true,
        "created_at": "2026-11-27T00:00:00.000Z"
      }]
    }$j$::jsonb,
    '{}'::jsonb
  )$q$,
  'value_mm'
);

select tests.expect_zero(
  'the customer from the rejected save is not in the database',
  $q$select 1 from public.customers where id = 'c0000000-0000-4000-8000-000000000002'$q$
);

select tests.expect_zero(
  'the job from the rejected save is not in the database',
  $q$select 1 from public.jobs where id = 'd0000000-0000-4000-8000-000000000002'$q$
);

select tests.expect_zero(
  'the evidence from the rejected save is not in the database',
  $q$select 1 from public.measurement_evidence where id = 'a0000000-0000-4000-8000-000000000002'$q$
);

select tests.expect_count(
  'the customer written by the successful save is untouched by the rejection',
  $q$select 1 from public.customers where id = 'c0000000-0000-4000-8000-000000000001' and name = 'Atomic Customer'$q$,
  1
);

-- A rejected save leaves the business settings as they were ------------------
select tests.expect_error(
  'a save that changes the business and then fails is refused',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    '{"display_name":"Should Not Persist","abn":"99999999999"}'::jsonb,
    $j${
      "customers": [{
        "id": "b0000000-0000-4000-8000-000000000003",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "name": "   ", "contact_name": "", "email": "", "phone": "", "address": "",
        "notes": "", "source_type": "TEST",
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }]
    }$j$::jsonb,
    '{}'::jsonb
  )$q$,
  'check constraint'
);

select tests.expect_count(
  'the business keeps its display name and ABN after the refused save',
  $q$select 1 from public.businesses
      where id = '00000000-0000-4000-8000-000000000001'
        and display_name = 'Atomic Test Roofing' and abn = '12345678901'$q$,
  1
);

-- A failed delete undoes the inserts and updates that preceded it ------------
select tests.expect_error(
  'a customer that still has jobs cannot be removed',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    $j${
      "customers": [{
        "id": "c0000000-0000-4000-8000-000000000003",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "name": "Inserted Before The Failed Delete", "contact_name": "", "email": "",
        "phone": "", "address": "", "notes": "", "source_type": "TEST",
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }],
      "jobs": [{
        "id": "d0000000-0000-4000-8000-000000000001",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "customer_id": "c0000000-0000-4000-8000-000000000001",
        "job_number": "J-3001", "title": "Atomic job", "site_address": "",
        "status": "measured", "notes": "changed by the save that failed", "source_type": "TEST",
        "profile_id": null, "crs_epsg": null, "operator_approved": false,
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }]
    }$j$::jsonb,
    $j${"customers": ["c0000000-0000-4000-8000-000000000001"]}$j$::jsonb
  )$q$,
  'foreign key'
);

select tests.expect_zero(
  'the customer inserted before the failed delete is not in the database',
  $q$select 1 from public.customers where id = 'c0000000-0000-4000-8000-000000000003'$q$
);

select tests.expect_count(
  'the job updated before the failed delete keeps its old status and notes',
  $q$select 1 from public.jobs
      where id = 'd0000000-0000-4000-8000-000000000001'
        and status = 'draft' and notes = ''$q$,
  1
);

select tests.expect_count(
  'the customer the failed delete targeted is still there',
  $q$select 1 from public.customers where id = 'c0000000-0000-4000-8000-000000000001'$q$,
  1
);

-- A delete that matches nothing is reported, not ignored ---------------------
select tests.expect_error(
  'removing a record that is not there is refused',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    '{}'::jsonb,
    $j${"flashings": ["f0000000-0000-4000-8000-0000000000ff"]}$j$::jsonb
  )$q$,
  'matched only 0'
);

-- A save cannot reach into another business ---------------------------------
select tests.expect_error(
  'a record belonging to another business is refused',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    $j${
      "customers": [{
        "id": "c0000000-0000-4000-8000-000000000004",
        "business_id": "00000000-0000-4000-8000-000000000002",
        "name": "Trespassing Customer", "contact_name": "", "email": "", "phone": "",
        "address": "", "notes": "", "source_type": "TEST",
        "created_at": "2026-11-27T00:00:00.000Z", "updated_at": "2026-11-27T00:00:00.000Z"
      }]
    }$j$::jsonb,
    '{}'::jsonb
  )$q$,
  'another business'
);

select tests.expect_zero(
  'the trespassing customer was not written anywhere',
  $q$select 1 from public.customers where id = 'c0000000-0000-4000-8000-000000000004'$q$
);

select tests.expect_error(
  'a column the table does not have is refused rather than dropped',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    $j${
      "customers": [{
        "id": "c0000000-0000-4000-8000-000000000005",
        "business_id": "00000000-0000-4000-8000-000000000001",
        "name": "Made Up Column", "made_up_column": 1
      }]
    }$j$::jsonb,
    '{}'::jsonb
  )$q$,
  'does not have'
);

select tests.expect_error(
  'a table this save cannot write is refused rather than skipped',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    null,
    '{"members": [{"business_id": "00000000-0000-4000-8000-000000000001"}]}'::jsonb,
    '{}'::jsonb
  )$q$,
  'cannot write'
);

select tests.expect_error(
  'a business setting this save cannot change is refused rather than skipped',
  $q$select public.save_workspace(
    '00000000-0000-4000-8000-000000000001',
    '{"created_at":"2000-01-01T00:00:00.000Z"}'::jsonb
  )$q$,
  'cannot set'
);

select tests.expect_count(
  'the refused business setting left the record alone',
  $q$select 1 from public.businesses
      where id = '00000000-0000-4000-8000-000000000001'
        and created_at > '2020-01-01T00:00:00.000Z'$q$,
  1
);

-- Someone else's member cannot drive this workspace -------------------------
set request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select tests.expect_error(
  'a member of another business cannot save into this workspace',
  $q$select public.save_workspace('00000000-0000-4000-8000-000000000001', '{"display_name":"Hijacked"}'::jsonb)$q$,
  'not a member'
);

set request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select tests.expect_count(
  'the workspace name survived the refused save from the other member',
  $q$select 1 from public.businesses
      where id = '00000000-0000-4000-8000-000000000001' and display_name = 'Atomic Test Roofing'$q$,
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
  raise notice '% of % atomic save assertions passed', v_total - v_failed, v_total;
  if v_failed > 0 then
    raise exception '% atomic save assertions failed', v_failed;
  end if;
end
$$;
