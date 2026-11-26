-- Sheet Set Pro — access control.
-- Every operational table is readable and writable only by a signed-in member of the
-- business that owns the row. Anonymous and signed-in-but-uninvited users get nothing.
-- Membership itself is only reachable through the two security-definer functions below.

alter table public.members enable row level security;
alter table public.businesses enable row level security;

create or replace function public.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
  );
$$;

do $do$
declare
  table_name text;
  scoped text[] := array[
    'customers', 'catalogue_profiles', 'jobs', 'roof_planes', 'flashings',
    'measurement_evidence', 'measurements', 'estimates', 'quotes', 'invoices',
    'payments', 'payment_allocations', 'calc_snapshots', 'activity_events'
  ];
begin
  foreach table_name in array scoped loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member(business_id))',
      table_name || '_member_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_member(business_id))',
      table_name || '_member_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id))',
      table_name || '_member_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_member(business_id))',
      table_name || '_member_delete', table_name
    );
  end loop;
end
$do$;

create policy businesses_member_select on public.businesses
  for select to authenticated using (public.is_member(id));

create policy businesses_member_update on public.businesses
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Onboarding: what a signed-in user may know before they belong to a workspace.
create or replace function public.workspace_status()
returns table (business_id uuid, display_name text, claimed boolean, is_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    b.display_name,
    exists (select 1 from public.members m where m.business_id = b.id) as claimed,
    public.is_member(b.id) as is_member
  from public.businesses b
  order by b.created_at
  limit 1;
$$;

-- The first authenticated user to ask takes ownership of an unclaimed workspace.
-- After that the door is shut: further users must be added by the owner.
create or replace function public.claim_workspace(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claimed boolean;
begin
  if v_user is null then
    raise exception 'Sign in before claiming a workspace.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Workspace not found.' using errcode = 'P0002';
  end if;

  select exists (select 1 from public.members m where m.business_id = p_business_id) into v_claimed;

  if v_claimed then
    return public.is_member(p_business_id);
  end if;

  insert into public.members (business_id, user_id, role)
  values (p_business_id, v_user, 'owner');

  return true;
end;
$$;

revoke all on function public.workspace_status() from public;
revoke all on function public.is_member(uuid) from public;
revoke all on function public.claim_workspace(uuid) from public;
grant execute on function public.workspace_status() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.claim_workspace(uuid) to authenticated;
