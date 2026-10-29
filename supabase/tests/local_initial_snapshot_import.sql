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
  owner_child_id uuid not null,
  parent_child_id uuid not null,
  rollback_child_id uuid not null,
  initialized_child_id uuid not null,
  outsider_child_id uuid not null,
  owner_import_id uuid not null,
  parent_import_id uuid not null,
  rollback_import_id uuid not null
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
  has_function_privilege(
    'authenticated',
    'public.import_initial_hapichike_snapshot(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,timestamptz,boolean,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated must be able to execute initial import RPC'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.import_initial_hapichike_snapshot(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,timestamptz,boolean,text,jsonb)',
    'EXECUTE'
  ),
  'anon must not be able to execute initial import RPC'
);

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.child_app_sync_state', 'INSERT,UPDATE,DELETE'),
  'authenticated direct sync-state writes must be unavailable'
);

with ids as (
  select
    gen_random_uuid() as owner_user_id,
    gen_random_uuid() as parent_user_id,
    gen_random_uuid() as viewer_user_id,
    gen_random_uuid() as outsider_user_id,
    gen_random_uuid() as household_a_id,
    gen_random_uuid() as household_b_id,
    gen_random_uuid() as owner_child_id,
    gen_random_uuid() as parent_child_id,
    gen_random_uuid() as rollback_child_id,
    gen_random_uuid() as initialized_child_id,
    gen_random_uuid() as outsider_child_id,
    gen_random_uuid() as owner_import_id,
    gen_random_uuid() as parent_import_id,
    gen_random_uuid() as rollback_import_id
)
insert into test_context select * from ids;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select owner_user_id, 'authenticated', 'authenticated', 'import-owner@example.test', now(), now() from test_context
union all select parent_user_id, 'authenticated', 'authenticated', 'import-parent@example.test', now(), now() from test_context
union all select viewer_user_id, 'authenticated', 'authenticated', 'import-viewer@example.test', now(), now() from test_context
union all select outsider_user_id, 'authenticated', 'authenticated', 'import-outsider@example.test', now(), now() from test_context;

insert into public.profiles (id, display_name)
select owner_user_id, 'Import Owner' from test_context
union all select parent_user_id, 'Import Parent' from test_context
union all select viewer_user_id, 'Import Viewer' from test_context
union all select outsider_user_id, 'Import Outsider' from test_context;

insert into public.households (id, name)
select household_a_id, 'Import Household A' from test_context
union all select household_b_id, 'Import Household B' from test_context;

insert into public.household_members (household_id, user_id, role)
select household_a_id, owner_user_id, 'owner' from test_context
union all select household_a_id, parent_user_id, 'parent' from test_context
union all select household_a_id, viewer_user_id, 'viewer' from test_context
union all select household_b_id, outsider_user_id, 'owner' from test_context;

insert into public.children (id, household_id, name)
select owner_child_id, household_a_id, 'Owner Import Child' from test_context
union all select parent_child_id, household_a_id, 'Parent Import Child' from test_context
union all select rollback_child_id, household_a_id, 'Rollback Import Child' from test_context
union all select initialized_child_id, household_a_id, 'Initialized Child' from test_context
union all select outsider_child_id, household_b_id, 'Outsider Child' from test_context;

update public.child_balances b
set tickets = 2
from test_context t
where b.child_id = t.initialized_child_id;

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.import_initial_hapichike_snapshot(
  (select owner_child_id from test_context),
  (select owner_import_id from test_context),
  1,
  repeat('a', 64),
  -2,
  3,
  -4,
  5,
  -6,
  1,
  now() - interval '1 minute',
  true,
  'Owner initial import',
  '{"test":"owner"}'::jsonb
);

select pg_temp.assert_true(
  (
    select b.tickets = -2
      and b.star_coins = 3
      and b.sweets_pay = -4
      and b.toy_pay = 5
      and b.game_pay = -6
      and b.happy_chance_cards = 1
    from public.child_balances b
    join test_context t on t.owner_child_id = b.child_id
  ),
  'owner import must set all six snapshot balances including allowed negatives'
);

select pg_temp.assert_true(
  (
    select s.initial_import_id = t.owner_import_id
      and s.initial_import_completed_at is not null
      and s.import_version = 1
      and s.source_snapshot_hash = repeat('a', 64)
    from public.child_app_sync_state s
    join test_context t on t.owner_child_id = s.child_id
    where s.app_id = 'hapichike'
  ),
  'sync state must record completion metadata'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.reward_logs r
    join test_context t on t.owner_child_id = r.child_id
    where r.type = 'initial_import'
      and r.metadata ->> 'app_id' = 'hapichike'
      and r.metadata ->> 'import_id' = t.owner_import_id::text
      and r.metadata -> 'snapshot' ->> 'tickets' = '-2'
      and r.metadata ? 'backup_created_at'
      and r.metadata ? 'approved_by'
  ),
  'initial import must append exactly one complete audit log'
);

-- Same id + same semantic payload is a no-op and does not append another log.
select public.import_initial_hapichike_snapshot(
  (select owner_child_id from test_context),
  (select owner_import_id from test_context),
  1, repeat('a', 64), -2, 3, -4, 5, -6, 1,
  now() - interval '1 minute', true, 'Retry', '{"retry":true}'::jsonb
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.reward_logs r
    join test_context t on t.owner_child_id = r.child_id
    where r.type = 'initial_import'
  ),
  'identical retry must not create a second log'
);

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,-1,3,-4,5,-6,1,now(),true)',
      t.owner_child_id, t.owner_import_id, repeat('a', 64)
    ),
    'same import id with different snapshot'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,-2,3,-4,5,-6,1,now(),true)',
      t.owner_child_id, gen_random_uuid(), repeat('a', 64)
    ),
    'same snapshot hash with another import id'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,-2,3,-4,5,-6,1,now(),true)',
      t.owner_child_id, gen_random_uuid(), repeat('b', 64)
    ),
    'second initial import with another id'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,-1,0,0,0,0,now(),true)',
      t.rollback_child_id, gen_random_uuid(), repeat('c', 64)
    ),
    'negative star coins'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,-1,now(),true)',
      t.rollback_child_id, gen_random_uuid(), repeat('d', 64)
    ),
    'negative happy chance cards'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,now(),false)',
      t.rollback_child_id, gen_random_uuid(), repeat('e', 64)
    ),
    'missing parent approval'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,null,true)',
      t.rollback_child_id, gen_random_uuid(), repeat('f', 64)
    ),
    'missing backup gate'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,now(),true)',
      t.initialized_child_id, gen_random_uuid(), repeat('1', 64)
    ),
    'cloud child with non-zero balance'
  );
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,now(),true)',
      t.outsider_child_id, gen_random_uuid(), repeat('2', 64)
    ),
    'other household child'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', (select parent_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select parent_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.import_initial_hapichike_snapshot(
  (select parent_child_id from test_context),
  (select parent_import_id from test_context),
  1, repeat('3', 64), 7, 8, 9, -10, 11, 12,
  now() - interval '2 minutes', true
);

select pg_temp.assert_true(
  (
    select b.tickets = 7 and b.star_coins = 8 and b.sweets_pay = 9
      and b.toy_pay = -10 and b.game_pay = 11 and b.happy_chance_cards = 12
    from public.child_balances b
    join test_context t on t.parent_child_id = b.child_id
  ),
  'parent import must succeed'
);

reset role;
select set_config('request.jwt.claim.sub', (select viewer_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select viewer_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 2 from public.child_app_sync_state),
  'viewer may read household sync state'
);

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,now(),true)',
      t.rollback_child_id, gen_random_uuid(), repeat('4', 64)
    ),
    'viewer initial import'
  );
  perform pg_temp.expect_error(
    format(
      'insert into public.child_app_sync_state(child_id,app_id) values (%L::uuid,%L)',
      t.rollback_child_id, 'hapichike'
    ),
    'direct sync state insert'
  );
end;
$$;

reset role;
set local role anon;
do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,0,0,0,0,0,0,now(),true)',
      t.rollback_child_id, gen_random_uuid(), repeat('5', 64)
    ),
    'anon initial import'
  );
end;
$$;

reset role;

create function pg_temp.reject_initial_import_log()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'initial_import' and new.metadata @> '{"test_force_log_failure":true}'::jsonb then
    raise exception 'intentional initial import log failure';
  end if;
  return new;
end;
$$;

create trigger reward_logs_reject_initial_import_test
before insert on public.reward_logs
for each row execute function pg_temp.reject_initial_import_log();

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.import_initial_hapichike_snapshot(%L::uuid,%L::uuid,1,%L,20,21,22,23,24,25,now(),true,null,%L::jsonb)',
      t.rollback_child_id,
      t.rollback_import_id,
      repeat('6', 64),
      '{"test_force_log_failure":true}'
    ),
    'reward log failure rolls back import'
  );
end;
$$;

select pg_temp.assert_true(
  (
    select b.tickets = 0 and b.star_coins = 0 and b.sweets_pay = 0
      and b.toy_pay = 0 and b.game_pay = 0 and b.happy_chance_cards = 0
    from public.child_balances b
    join test_context t on t.rollback_child_id = b.child_id
  )
  and not exists (
    select 1 from public.child_app_sync_state s
    join test_context t on t.rollback_child_id = s.child_id
  )
  and not exists (
    select 1 from public.reward_logs r
    join test_context t on t.rollback_child_id = r.child_id
  ),
  'failed audit log must roll back balances, sync state, and log'
);

-- Existing 005 RPC and read model remain usable after an import.
select public.add_ticket((select owner_child_id from test_context), 1, 'Post-import probe');
select pg_temp.assert_true(
  (
    select b.tickets = -1
    from public.child_balances b
    join test_context t on t.owner_child_id = b.child_id
  )
  and (
    select count(*) = 2
    from public.reward_logs r
    join test_context t on t.owner_child_id = r.child_id
  ),
  '005 reward RPC and reward read model remain intact'
);

reset role;
rollback;

\echo 'PASS: initial snapshot import tests rolled back all test data'
