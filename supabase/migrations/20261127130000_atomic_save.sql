-- Sheet Set Pro — one save, one transaction.
--
-- A save is a single operator action, so it must land completely or not at all. Writing
-- each table as its own PostgREST request allowed a half-applied change: the job status
-- committed while the quote that justified it was refused, leaving records that disagree
-- with each other. This function is now the only write path for the workspace.
--
-- It is SECURITY INVOKER on purpose: the caller's own database role runs every statement,
-- so row level security, the history triggers, the allocation guard and every constraint
-- behave exactly as they did for the statements it replaces. There is no bypass here and
-- no elevated privilege to leak.

create or replace function public.save_workspace(
  p_business_id uuid,
  p_business jsonb default null,
  p_upserts jsonb default '{}'::jsonb,
  p_deletes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so a foreign key is satisfied by the time it is checked.
  -- Deletes walk this list backwards, so children go before their parents.
  c_tables constant text[] := array[
    'customers', 'catalogue_profiles', 'jobs', 'roof_planes', 'flashings',
    'measurement_evidence', 'measurements', 'estimates', 'quotes', 'invoices',
    'payments', 'payment_allocations', 'calc_snapshots', 'activity_events'
  ];
  v_table text;
  v_rows jsonb;
  v_row jsonb;
  v_ids jsonb;
  v_keys text[];
  v_known text[];
  v_columns text;
  v_set text;
  v_id_list text[];
  v_upserted jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
  i integer;
begin
  if p_business_id is null then
    raise exception 'A workspace save must name the business it belongs to.' using errcode = '22023';
  end if;

  if not public.is_member(p_business_id) then
    raise exception 'You are not a member of this workspace.' using errcode = '42501';
  end if;

  if p_business is not null and jsonb_typeof(p_business) <> 'object' then
    raise exception 'Business settings must be a JSON object.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_upserts, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_deletes, '{}'::jsonb)) <> 'object' then
    raise exception 'A workspace save takes upserts and deletes keyed by table.' using errcode = '22023';
  end if;

  -- A table or business column this function cannot write is refused, never skipped:
  -- a typo that silently wrote nothing would look like a save that worked.
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_upserts, '{}'::jsonb)) as k
     where k <> all (c_tables)
  ) then
    raise exception 'This save cannot write: %.', (
      select string_agg(k, ', ') from jsonb_object_keys(coalesce(p_upserts, '{}'::jsonb)) as k
       where k <> all (c_tables)
    ) using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(coalesce(p_deletes, '{}'::jsonb)) as k
     where k <> all (c_tables)
  ) then
    raise exception 'This save cannot remove from: %.', (
      select string_agg(k, ', ') from jsonb_object_keys(coalesce(p_deletes, '{}'::jsonb)) as k
       where k <> all (c_tables)
    ) using errcode = '22023';
  end if;

  if p_business is not null and exists (
    select 1 from jsonb_object_keys(p_business) as k
     where k <> all (array[
       'id', 'display_name', 'legal_name', 'abn', 'gst_registered', 'gst_rate_bp',
       'gst_rate_confirmed', 'address', 'email', 'phone', 'labour_rate_cents_per_m2',
       'labour_cost_cents_per_m2', 'default_margin_bp'
     ])
  ) then
    raise exception 'This save cannot set: %.', (
      select string_agg(k, ', ') from jsonb_object_keys(p_business) as k
       where k <> all (array[
         'id', 'display_name', 'legal_name', 'abn', 'gst_registered', 'gst_rate_bp',
         'gst_rate_confirmed', 'address', 'email', 'phone', 'labour_rate_cents_per_m2',
         'labour_cost_cents_per_m2', 'default_margin_bp'
       ])
    ) using errcode = '22023';
  end if;

  -- Business settings. Only the columns an operator can edit. `id` is accepted because the
  -- client sends the whole settings row, but it is never assigned: the update is pinned to
  -- p_business_id. A key the caller omits is left as it is rather than nulled.
  if p_business is not null then
    update public.businesses b set
      display_name = case when p_business ? 'display_name'
        then p_business ->> 'display_name' else b.display_name end,
      legal_name = case when p_business ? 'legal_name'
        then p_business ->> 'legal_name' else b.legal_name end,
      abn = case when p_business ? 'abn'
        then p_business ->> 'abn' else b.abn end,
      gst_registered = case when p_business ? 'gst_registered'
        then (p_business ->> 'gst_registered')::boolean else b.gst_registered end,
      gst_rate_bp = case when p_business ? 'gst_rate_bp'
        then (p_business ->> 'gst_rate_bp')::integer else b.gst_rate_bp end,
      gst_rate_confirmed = case when p_business ? 'gst_rate_confirmed'
        then (p_business ->> 'gst_rate_confirmed')::boolean else b.gst_rate_confirmed end,
      address = case when p_business ? 'address'
        then p_business ->> 'address' else b.address end,
      email = case when p_business ? 'email'
        then p_business ->> 'email' else b.email end,
      phone = case when p_business ? 'phone'
        then p_business ->> 'phone' else b.phone end,
      labour_rate_cents_per_m2 = case when p_business ? 'labour_rate_cents_per_m2'
        then (p_business ->> 'labour_rate_cents_per_m2')::integer else b.labour_rate_cents_per_m2 end,
      labour_cost_cents_per_m2 = case when p_business ? 'labour_cost_cents_per_m2'
        then (p_business ->> 'labour_cost_cents_per_m2')::integer else b.labour_cost_cents_per_m2 end,
      default_margin_bp = case when p_business ? 'default_margin_bp'
        then (p_business ->> 'default_margin_bp')::integer else b.default_margin_bp end,
      updated_at = now()
    where b.id = p_business_id;

    if not found then
      raise exception 'Workspace not found.' using errcode = 'P0002';
    end if;
  end if;

  -- Upserts, parents first.
  foreach v_table in array c_tables loop
    v_rows := coalesce(p_upserts -> v_table, '[]'::jsonb);

    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'Upserts for % must be an array of records.', v_table using errcode = '22023';
    end if;

    if jsonb_array_length(v_rows) = 0 then
      continue;
    end if;

    select array_agg(a.attname::text) into v_known
      from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.format('public.%I', v_table)::regclass
       and a.attnum > 0
       and not a.attisdropped;

    for i in 0 .. jsonb_array_length(v_rows) - 1 loop
      v_row := v_rows -> i;

      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'A % record must be a JSON object.', v_table using errcode = '22023';
      end if;

      if v_row ->> 'business_id' is distinct from p_business_id::text then
        raise exception 'A % record cannot be written into another business.', v_table
          using errcode = '42501';
      end if;

      select array_agg(k order by k) into v_keys from jsonb_object_keys(v_row) as k;

      if v_keys is null or not (v_keys <@ v_known) then
        raise exception 'A % record names columns that table does not have: %.', v_table,
          coalesce((select string_agg(k, ', ') from unnest(v_keys) as k where k <> all (v_known)), '')
          using errcode = '42703';
      end if;

      select string_agg(pg_catalog.format('%I', k), ', ' order by k)
        into v_columns from unnest(v_keys) as k;
      select string_agg(pg_catalog.format('%I = excluded.%I', k, k), ', ' order by k)
        into v_set from unnest(v_keys) as k where k <> 'id';

      if v_set is null then
        execute pg_catalog.format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)'
          ' on conflict (id) do nothing',
          v_table, v_columns, v_columns, v_table
        ) using v_row;
      else
        execute pg_catalog.format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)'
          ' on conflict (id) do update set %s',
          v_table, v_columns, v_columns, v_table, v_set
        ) using v_row;
      end if;
    end loop;

    v_upserted := v_upserted || jsonb_build_object(v_table, jsonb_array_length(v_rows));
  end loop;

  -- Deletes, children first. A delete that matches nothing is reported rather than
  -- ignored: the row was either removed elsewhere or never belonged to this workspace,
  -- and either way the operator's screen is out of date.
  for i in reverse array_upper(c_tables, 1) .. 1 loop
    v_table := c_tables[i];
    v_ids := coalesce(p_deletes -> v_table, '[]'::jsonb);

    if jsonb_typeof(v_ids) <> 'array' then
      raise exception 'Deletes for % must be an array of ids.', v_table using errcode = '22023';
    end if;

    if jsonb_array_length(v_ids) = 0 then
      continue;
    end if;

    select array_agg(value) into v_id_list from jsonb_array_elements_text(v_ids) as value;

    execute pg_catalog.format('delete from public.%I where id::text = any ($1)', v_table)
      using v_id_list;
    get diagnostics v_count = row_count;

    if v_count <> jsonb_array_length(v_ids) then
      raise exception 'Removing % % record(s) matched only %; reload the workspace before retrying.',
        jsonb_array_length(v_ids), v_table, v_count using errcode = 'P0002';
    end if;

    v_deleted := v_deleted || jsonb_build_object(v_table, v_count);
  end loop;

  return jsonb_build_object('upserted', v_upserted, 'deleted', v_deleted);
end;
$$;

comment on function public.save_workspace(uuid, jsonb, jsonb, jsonb) is
  'Applies a whole workspace save in one transaction as the calling user: business settings, then upserts parents-first, then deletes children-first. Any failure rolls back every part of the save.';

revoke all on function public.save_workspace(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_workspace(uuid, jsonb, jsonb, jsonb) to authenticated;
