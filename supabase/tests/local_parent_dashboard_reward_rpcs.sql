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
  child_a_id uuid not null,
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
  has_function_privilege('authenticated', 'public.add_ticket(uuid,integer,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.add_star_coin(uuid,integer,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.exchange_star_coins_for_ticket(uuid,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.adjust_pay_balance(uuid,text,integer,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.adjust_happy_chance(uuid,integer,text,text,jsonb)', 'EXECUTE'),
  'authenticated must be able to execute every reward RPC'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.add_ticket(uuid,integer,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_star_coin(uuid,integer,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.exchange_star_coins_for_ticket(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.adjust_pay_balance(uuid,text,integer,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.adjust_happy_chance(uuid,integer,text,text,jsonb)', 'EXECUTE'),
  'anon must not be able to execute reward RPCs'
);

select pg_temp.assert_true(
  position('FOR UPDATE' in upper(pg_get_functiondef('public.exchange_star_coins_for_ticket(uuid,text,text,jsonb)'::regprocedure))) > 0,
  'star exchange must lock the balance row'
);

with ids as (
  select
    gen_random_uuid() as owner_user_id,
    gen_random_uuid() as parent_user_id,
    gen_random_uuid() as viewer_user_id,
    gen_random_uuid() as outsider_user_id,
    gen_random_uuid() as household_a_id,
    gen_random_uuid() as household_b_id,
    gen_random_uuid() as child_a_id,
    gen_random_uuid() as child_b_id
)
insert into test_context select * from ids;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select owner_user_id, 'authenticated', 'authenticated', 'reward-owner@example.test', now(), now() from test_context
union all
select parent_user_id, 'authenticated', 'authenticated', 'reward-parent@example.test', now(), now() from test_context
union all
select viewer_user_id, 'authenticated', 'authenticated', 'reward-viewer@example.test', now(), now() from test_context
union all
select outsider_user_id, 'authenticated', 'authenticated', 'reward-outsider@example.test', now(), now() from test_context;

insert into public.profiles (id, display_name)
select owner_user_id, 'Reward Owner' from test_context
union all select parent_user_id, 'Reward Parent' from test_context
union all select viewer_user_id, 'Reward Viewer' from test_context
union all select outsider_user_id, 'Reward Outsider' from test_context;

insert into public.households (id, name)
select household_a_id, 'Reward Household A' from test_context
union all select household_b_id, 'Reward Household B' from test_context;

insert into public.household_members (household_id, user_id, role)
select household_a_id, owner_user_id, 'owner' from test_context
union all select household_a_id, parent_user_id, 'parent' from test_context
union all select household_a_id, viewer_user_id, 'viewer' from test_context
union all select household_b_id, outsider_user_id, 'owner' from test_context;

insert into public.children (id, household_id, name)
select child_a_id, household_a_id, 'Reward Child A' from test_context
union all select child_b_id, household_b_id, 'Reward Child B' from test_context;

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.add_ticket(
  (select child_a_id from test_context),
  3,
  'Ticket reward',
  'Owner added tickets',
  '{"source":"test"}'::jsonb
);

select pg_temp.assert_true(
  (select b.tickets = 3 from public.child_balances b join test_context t on b.child_id = t.child_a_id)
  and (select count(*) = 1 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'ticket' and r.amount = 3 and r.household_id = t.household_a_id),
  'owner add_ticket must update balance and append a matching log'
);

reset role;
select set_config('request.jwt.claim.sub', (select parent_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select parent_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.add_ticket((select child_a_id from test_context), -1, 'Ticket spend');
select pg_temp.assert_true(
  (select b.tickets = 2 from public.child_balances b join test_context t on b.child_id = t.child_a_id),
  'parent add_ticket must succeed and ticket balances may decrease'
);

reset role;
select set_config('request.jwt.claim.sub', (select viewer_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select viewer_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format('select public.add_ticket(%L::uuid, 1)', t.child_a_id),
    'viewer add_ticket'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.add_ticket(%L::uuid, 1)', t.child_b_id), 'other household child');
  perform pg_temp.expect_error(format('select public.add_ticket(%L::uuid, 0)', t.child_a_id), 'zero ticket amount');
  perform pg_temp.expect_error(format('select public.add_ticket(%L::uuid, 1)', gen_random_uuid()), 'unknown child');
  perform pg_temp.expect_error('select public.add_ticket(null, 1)', 'null child id');
end;
$$;

select pg_temp.assert_true(
  (select b.tickets = 2 from public.child_balances b join test_context t on b.child_id = t.child_a_id),
  'rejected ticket updates must leave the balance unchanged'
);

reset role;
set local role anon;
do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.add_ticket(%L::uuid, 1)', t.child_a_id), 'anon add_ticket');
end;
$$;

reset role;

create function pg_temp.reject_reward_log_probe()
returns trigger
language plpgsql
as $$
begin
  if new.metadata @> '{"test_force_log_failure":true}'::jsonb then
    raise exception 'intentional reward log failure';
  end if;
  return new;
end;
$$;

create trigger reward_logs_test_reject
before insert on public.reward_logs
for each row execute function pg_temp.reject_reward_log_probe();

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.add_ticket(%L::uuid, 9, null, null, %L::jsonb)',
      t.child_a_id,
      '{"test_force_log_failure":true}'
    ),
    'log failure rolls back balance update'
  );
end;
$$;

select pg_temp.assert_true(
  (select b.tickets = 2 from public.child_balances b join test_context t on b.child_id = t.child_a_id)
  and (select count(*) = 0 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.metadata @> '{"test_force_log_failure":true}'::jsonb),
  'a failed log insert must roll back the balance update'
);

reset role;
drop trigger reward_logs_test_reject on public.reward_logs;
drop function pg_temp.reject_reward_log_probe();

select set_config('request.jwt.claim.sub', (select owner_user_id::text from test_context), true);
select set_config('request.jwt.claims', json_build_object('sub', (select owner_user_id from test_context), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.add_star_coin((select child_a_id from test_context), 4, 'Star reward');
do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.exchange_star_coins_for_ticket(%L::uuid)', t.child_a_id), 'exchange below five stars');
end;
$$;
select pg_temp.assert_true(
  (select b.star_coins = 4 and b.tickets = 2 from public.child_balances b join test_context t on b.child_id = t.child_a_id),
  'failed exchange must leave both balances unchanged'
);

select public.add_star_coin((select child_a_id from test_context), 1);
select public.exchange_star_coins_for_ticket((select child_a_id from test_context), 'Star exchange');
select pg_temp.assert_true(
  (select b.star_coins = 0 and b.tickets = 3 from public.child_balances b join test_context t on b.child_id = t.child_a_id)
  and (select count(*) = 1 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'star_exchange' and r.amount = 1 and r.metadata ->> 'star_coins_used' = '5'),
  'exchange must atomically subtract five stars, add one ticket, and log once'
);

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.exchange_star_coins_for_ticket(%L::uuid)', t.child_a_id), 'second exchange from the same five stars');
  perform pg_temp.expect_error(format('select public.add_star_coin(%L::uuid, -1)', t.child_a_id), 'negative star balance');
end;
$$;

select pg_temp.assert_true(
  (select b.star_coins = 0 and b.tickets = 3 from public.child_balances b join test_context t on b.child_id = t.child_a_id),
  'double exchange and negative star balance must be prevented'
);

select public.adjust_pay_balance((select child_a_id from test_context), 'sweets', 7);
select public.adjust_pay_balance((select child_a_id from test_context), 'sweets', -9);
select public.adjust_pay_balance((select child_a_id from test_context), 'toy', 4);
select public.adjust_pay_balance((select child_a_id from test_context), 'game', -3);

select pg_temp.assert_true(
  (select b.sweets_pay = -2 and b.toy_pay = 4 and b.game_pay = -3 from public.child_balances b join test_context t on b.child_id = t.child_a_id)
  and (select count(*) = 2 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'sweets_pay')
  and (select count(*) = 1 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'toy_pay' and r.amount = 4)
  and (select count(*) = 1 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'game_pay' and r.amount = -3),
  'all PAY types must support logged increases and decreases, including negative balances'
);

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.adjust_pay_balance(%L::uuid, %L, 1)', t.child_a_id, 'invalid'), 'invalid pay type');
end;
$$;

select public.adjust_happy_chance((select child_a_id from test_context), 2);
select public.adjust_happy_chance((select child_a_id from test_context), -1);
do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('select public.adjust_happy_chance(%L::uuid, -2)', t.child_a_id), 'negative happy chance balance');
end;
$$;

select pg_temp.assert_true(
  (select b.happy_chance_cards = 1 from public.child_balances b join test_context t on b.child_id = t.child_a_id)
  and (select count(*) = 2 from public.reward_logs r join test_context t on r.child_id = t.child_a_id where r.type = 'happy_chance'),
  'happy chance increases and valid decreases must be logged; negative result must fail'
);

do $$
declare t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(format('update public.child_balances set tickets = 99 where child_id = %L::uuid', t.child_a_id), 'direct balance update');
  perform pg_temp.expect_error(format('insert into public.reward_logs (household_id, child_id, type) values (%L::uuid, %L::uuid, %L)', t.household_a_id, t.child_a_id, 'forbidden'), 'direct log insert');
  perform pg_temp.expect_error(format('update public.reward_logs set title = %L where child_id = %L::uuid', 'forbidden', t.child_a_id), 'reward log update');
  perform pg_temp.expect_error(format('delete from public.reward_logs where child_id = %L::uuid', t.child_a_id), 'reward log delete');
end;
$$;

select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.child_balances', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.reward_logs', 'INSERT,UPDATE,DELETE'),
  'direct writes must remain unavailable to authenticated'
);

reset role;
rollback;

\echo 'PASS: parent dashboard reward RPC tests rolled back all test data'
