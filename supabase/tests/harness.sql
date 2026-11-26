-- Shared assertion helpers for the database test suite.
create schema if not exists tests;

create table if not exists tests.results (
  n serial primary key,
  name text not null,
  ok boolean not null,
  detail text not null default ''
);

create or replace function tests.record(p_name text, p_ok boolean, p_detail text default '')
returns void
language sql
as $$
  insert into tests.results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

create or replace function tests.expect_error(p_name text, p_sql text, p_like text default null)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
    perform tests.record(p_name, false, 'statement succeeded but should have been rejected');
  exception when others then
    if p_like is null or sqlerrm ilike '%' || p_like || '%' then
      perform tests.record(p_name, true, sqlerrm);
    else
      perform tests.record(p_name, false, 'rejected with the wrong reason: ' || sqlerrm);
    end if;
  end;
end;
$$;

create or replace function tests.expect_zero(p_name text, p_sql text)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into v_count;
  perform tests.record(p_name, v_count = 0, format('rows visible: %s', v_count));
end;
$$;

create or replace function tests.expect_count(p_name text, p_sql text, p_expected bigint)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into v_count;
  perform tests.record(p_name, v_count = p_expected, format('expected %s, saw %s', p_expected, v_count));
end;
$$;

grant usage on schema tests to anon, authenticated;
grant select, insert on tests.results to anon, authenticated;
grant usage, select on sequence tests.results_n_seq to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;
