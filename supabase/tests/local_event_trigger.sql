\set ON_ERROR_STOP on
\set VERBOSITY terse

begin;

create function pg_temp.expect_permission_denied(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then
      raise notice 'PASS permission denied [%]', p_message;
      return;
  end;

  raise exception 'TEST ASSERTION FAILED: expected permission denied: %', p_message;
end;
$$;

grant execute on function pg_temp.expect_permission_denied(text, text)
  to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_event_trigger
    where evtname = 'ensure_rls'
      and evtevent = 'ddl_command_end'
      and evtenabled <> 'D'
  ) then
    raise exception 'TEST ASSERTION FAILED: ensure_rls is missing or disabled';
  end if;

  if has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE') then
    raise exception 'TEST ASSERTION FAILED: rls_auto_enable has an unnecessary EXECUTE privilege';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'TEST ASSERTION FAILED: PUBLIC can execute rls_auto_enable';
  end if;
end;
$$;

set local role anon;
select pg_temp.expect_permission_denied(
  'select public.rls_auto_enable()',
  'anon direct rls_auto_enable call'
);

reset role;
set local role authenticated;
select pg_temp.expect_permission_denied(
  'select public.rls_auto_enable()',
  'authenticated direct rls_auto_enable call'
);

reset role;

create table public._hapichike_rls_probe (
  id bigint generated always as identity primary key
);

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = '_hapichike_rls_probe'
      and c.relkind = 'r'
      and c.relrowsecurity
  ) then
    raise exception 'TEST ASSERTION FAILED: ensure_rls did not enable RLS';
  end if;
end;
$$;

rollback;

\echo 'PASS: ensure_rls enabled RLS and the test DDL was rolled back'
