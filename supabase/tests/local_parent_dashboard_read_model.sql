\set ON_ERROR_STOP on
\set VERBOSITY terse

begin;

create temporary table test_context (
  owner_user_id uuid not null,
  parent_user_id uuid not null,
  viewer_user_id uuid not null,
  outsider_user_id uuid not null,
  household_a_id uuid not null,
  household_b_id uuid not null,
  child_a_first_id uuid not null,
  child_a_second_id uuid not null,
  child_b_id uuid not null
) on commit drop;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'TEST ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create function pg_temp.expect_error(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS expected error [%]: % (%)', p_message, sqlerrm, sqlstate;
      return;
  end;

  raise exception 'TEST ASSERTION FAILED: expected error: %', p_message;
end;
$$;

grant select on test_context to anon, authenticated;
grant execute on function pg_temp.assert_true(boolean, text) to anon, authenticated;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

select pg_temp.assert_true(
  to_regclass('public.child_balances') is not null
  and to_regclass('public.reward_logs') is not null,
  'read model tables must exist'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'children'
      and column_name = 'display_order'
      and data_type = 'integer'
      and is_nullable = 'NO'
      and column_default = '0'
  ),
  'children.display_order must be a non-null integer defaulting to zero'
);

select pg_temp.assert_true(
  (select relrowsecurity from pg_class where oid = 'public.child_balances'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.reward_logs'::regclass),
  'RLS must be enabled on both read model tables'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.child_balances', 'SELECT')
  and has_table_privilege('authenticated', 'public.reward_logs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.child_balances', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.reward_logs', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.child_balances', 'SELECT')
  and not has_table_privilege('anon', 'public.reward_logs', 'SELECT')
  and not has_table_privilege('public', 'public.child_balances', 'SELECT')
  and not has_table_privilege('public', 'public.reward_logs', 'SELECT'),
  'table grants must be read-only for authenticated and absent for anon/PUBLIC'
);

with ids as (
  select
    gen_random_uuid() as owner_user_id,
    gen_random_uuid() as parent_user_id,
    gen_random_uuid() as viewer_user_id,
    gen_random_uuid() as outsider_user_id,
    gen_random_uuid() as household_a_id,
    gen_random_uuid() as household_b_id,
    gen_random_uuid() as child_a_first_id,
    gen_random_uuid() as child_a_second_id,
    gen_random_uuid() as child_b_id
)
insert into test_context select * from ids;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select owner_user_id, 'authenticated', 'authenticated', 'read-owner@example.test', now(), now() from test_context
union all
select parent_user_id, 'authenticated', 'authenticated', 'read-parent@example.test', now(), now() from test_context
union all
select viewer_user_id, 'authenticated', 'authenticated', 'read-viewer@example.test', now(), now() from test_context
union all
select outsider_user_id, 'authenticated', 'authenticated', 'read-outsider@example.test', now(), now() from test_context;

insert into public.profiles (id, display_name)
select owner_user_id, 'Read Owner' from test_context
union all select parent_user_id, 'Read Parent' from test_context
union all select viewer_user_id, 'Read Viewer' from test_context
union all select outsider_user_id, 'Read Outsider' from test_context;

insert into public.households (id, name)
select household_a_id, 'Read Household A' from test_context
union all select household_b_id, 'Read Household B' from test_context;

insert into public.household_members (household_id, user_id, role)
select household_a_id, owner_user_id, 'owner' from test_context
union all select household_a_id, parent_user_id, 'parent' from test_context
union all select household_a_id, viewer_user_id, 'viewer' from test_context
union all select household_b_id, outsider_user_id, 'owner' from test_context;

insert into public.children (id, household_id, name, display_order)
select child_a_first_id, household_a_id, 'Second Displayed', 20 from test_context
union all select child_a_second_id, household_a_id, 'First Displayed', 10 from test_context
union all select child_b_id, household_b_id, 'Other Household Child', 0 from test_context;

select pg_temp.assert_true(
  (select count(*) = 3 from public.child_balances),
  'new children must receive one initial balance row each'
);

update public.child_balances b
set tickets = 7,
    star_coins = 4,
    sweets_pay = -2,
    toy_pay = 3,
    game_pay = 9,
    happy_chance_cards = 1
from test_context t
where b.child_id = t.child_a_first_id;

insert into public.reward_logs (
  household_id, child_id, type, title, message, amount, metadata, created_at
)
select
  t.household_a_id,
  t.child_a_first_id,
  'ticket_added',
  'Log ' || n,
  'dashboard compatibility',
  n,
  jsonb_build_object('sequence', n),
  timestamptz '2026-10-08 00:00:00+00' + n * interval '1 minute'
from test_context t
cross join generate_series(1, 25) n;

insert into public.reward_logs (household_id, child_id, type, title)
select household_b_id, child_b_id, 'ticket_added', 'Other Household Log'
from test_context;

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'insert into public.reward_logs (household_id, child_id, type) values (%L::uuid, %L::uuid, %L)',
      t.household_b_id, t.child_a_first_id, 'mismatch'
    ),
    'reward log child-household mismatch'
  );
end;
$$;

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 2 from public.child_balances b join test_context t on b.child_id in (t.child_a_first_id, t.child_a_second_id)),
  'owner must read own household balances'
);
select pg_temp.assert_true(
  (select count(*) = 25 from public.reward_logs r join test_context t on r.child_id = t.child_a_first_id),
  'owner must read own household logs'
);
select pg_temp.assert_true(
  (select array_agg(c.name order by c.display_order) = array['First Displayed', 'Second Displayed']::text[]
   from public.children c join test_context t on c.household_id = t.household_a_id),
  'children query ordered by display_order must work'
);
select pg_temp.assert_true(
  (select count(*) = 20
   from (
     select r.*
     from public.reward_logs r
     join test_context t on r.child_id = t.child_a_first_id
     order by r.created_at desc
     limit 20
   ) recent),
  'recent reward logs query with descending order and limit 20 must work'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('insert into public.child_balances (child_id) values (%L::uuid)', t.child_a_first_id), 'authenticated balance insert');
  perform pg_temp.expect_error(format('update public.child_balances set tickets = 99 where child_id = %L::uuid', t.child_a_first_id), 'authenticated balance update');
  perform pg_temp.expect_error(format('delete from public.child_balances where child_id = %L::uuid', t.child_a_first_id), 'authenticated balance delete');
  perform pg_temp.expect_error(format('insert into public.reward_logs (household_id, child_id, type) values (%L::uuid, %L::uuid, %L)', t.household_a_id, t.child_a_first_id, 'forbidden'), 'authenticated log insert');
  perform pg_temp.expect_error(format('update public.reward_logs set title = %L where child_id = %L::uuid', 'forbidden', t.child_a_first_id), 'authenticated log update');
  perform pg_temp.expect_error(format('delete from public.reward_logs where child_id = %L::uuid', t.child_a_first_id), 'authenticated log delete');
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', (select parent_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select parent_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_true(
  (select count(*) = 2 from public.child_balances b join test_context t on b.child_id in (t.child_a_first_id, t.child_a_second_id))
  and (select count(*) = 25 from public.reward_logs r join test_context t on r.child_id = t.child_a_first_id),
  'parent must read own household balances and logs'
);

reset role;
select set_config('request.jwt.claim.sub', (select viewer_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select viewer_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_true(
  (select count(*) = 2 from public.child_balances b join test_context t on b.child_id in (t.child_a_first_id, t.child_a_second_id))
  and (select count(*) = 25 from public.reward_logs r join test_context t on r.child_id = t.child_a_first_id),
  'viewer must read own household balances and logs'
);

reset role;
select set_config('request.jwt.claim.sub', (select outsider_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select outsider_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_true(
  (select count(*) = 0 from public.child_balances b join test_context t on b.child_id in (t.child_a_first_id, t.child_a_second_id))
  and (select count(*) = 0 from public.reward_logs r join test_context t on r.child_id = t.child_a_first_id),
  'another household user must not read balances or logs'
);

reset role;
set local role anon;
select pg_temp.expect_error('select * from public.child_balances', 'anon balance select');
select pg_temp.expect_error('select * from public.reward_logs', 'anon log select');

reset role;
rollback;

\echo 'PASS: parent dashboard read model tests rolled back all test data'
