\set ON_ERROR_STOP on
\set VERBOSITY terse

begin;

create temporary table test_context (
  owner_user_id uuid not null,
  parent_user_id uuid not null,
  viewer_user_id uuid not null,
  outsider_user_id uuid not null,
  household_a_id uuid,
  household_b_id uuid,
  owner_child_id uuid,
  parent_child_id uuid,
  outsider_child_id uuid
) on commit drop;

insert into test_context (
  owner_user_id,
  parent_user_id,
  viewer_user_id,
  outsider_user_id
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

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
declare
  caught_state text;
  caught_message text;
begin
  begin
    execute p_sql;
  exception
    when others then
      caught_state := sqlstate;
      caught_message := sqlerrm;
  end;

  if caught_state is null then
    raise exception 'TEST ASSERTION FAILED: expected error: %', p_message;
  end if;

  raise notice 'PASS expected error [%]: % (%)', p_message, caught_message, caught_state;
end;
$$;

create function pg_temp.assert_write_rejected(p_sql text, p_message text)
returns void
language plpgsql
as $$
declare
  affected_rows bigint;
  caught_state text;
  caught_message text;
begin
  begin
    execute p_sql;
    get diagnostics affected_rows = row_count;
  exception
    when others then
      caught_state := sqlstate;
      caught_message := sqlerrm;
  end;

  if caught_state is not null then
    raise notice 'PASS rejected write by error [%]: % (%)',
      p_message, caught_message, caught_state;
    return;
  end if;

  if affected_rows <> 0 then
    raise exception
      'TEST ASSERTION FAILED: rejected write affected % row(s): %',
      affected_rows,
      p_message;
  end if;

  raise notice 'PASS rejected write with 0 affected rows [%]', p_message;
end;
$$;

grant select, update on test_context to authenticated;
grant execute on function pg_temp.assert_true(boolean, text) to authenticated, anon;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;
grant execute on function pg_temp.assert_write_rejected(text, text)
  to authenticated, anon;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select owner_user_id, 'authenticated', 'authenticated',
       'local-owner-' || owner_user_id || '@example.test', now(), now()
from test_context
union all
select parent_user_id, 'authenticated', 'authenticated',
       'local-parent-' || parent_user_id || '@example.test', now(), now()
from test_context
union all
select viewer_user_id, 'authenticated', 'authenticated',
       'local-viewer-' || viewer_user_id || '@example.test', now(), now()
from test_context
union all
select outsider_user_id, 'authenticated', 'authenticated',
       'local-outsider-' || outsider_user_id || '@example.test', now(), now()
from test_context;

insert into public.profiles (id, display_name)
select owner_user_id, 'Local Owner' from test_context
union all
select parent_user_id, 'Local Parent' from test_context
union all
select viewer_user_id, 'Local Viewer' from test_context
union all
select outsider_user_id, 'Local Outsider' from test_context;

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.create_household(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.add_household_member(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_household_member_role(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_household_member(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.transfer_household_ownership(uuid,uuid,text)', 'EXECUTE'),
  'authenticated must be able to execute household RPCs'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.create_household(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_household_member(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_household_member_role(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.remove_household_member(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.transfer_household_ownership(uuid,uuid,text)', 'EXECUTE'),
  'anon must not be able to execute household RPCs'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select owner_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

with created as (
  select id from public.create_household('Local Household A')
)
update test_context t
set household_a_id = created.id
from created;

select pg_temp.assert_true(
  (select count(*) = 1
   from public.household_members hm
   join test_context t
     on hm.household_id = t.household_a_id
    and hm.user_id = t.owner_user_id
   where hm.role = 'owner'),
  'create_household must create exactly one owner membership'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.households h
   join test_context t on h.id = t.household_a_id),
  'owner must be able to read its household'
);

do $$
begin
  perform pg_temp.expect_error(
    'select public.create_household(''   '')',
    'blank household name'
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 1 from public.households),
  'failed household creation must not leave a household row'
);

select public.add_household_member(
  (select household_a_id from test_context),
  (select parent_user_id from test_context),
  'parent'
);
select public.add_household_member(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context),
  'viewer'
);

select public.set_household_member_role(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context),
  'parent'
);
select public.set_household_member_role(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context),
  'viewer'
);
select public.remove_household_member(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context)
);
select public.add_household_member(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context),
  'viewer'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.add_household_member(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.outsider_user_id,
      'invalid-role'
    ),
    'invalid household role'
  );
  perform pg_temp.expect_error(
    format(
      'select public.set_household_member_role(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      gen_random_uuid(),
      'parent'
    ),
    'unknown household member id'
  );
end;
$$;

insert into public.children (household_id, name, nickname)
select household_a_id, 'Owner Child', 'Owner'
from test_context
returning id \gset owner_child_

update test_context
set owner_child_id = :'owner_child_id'::uuid;

update public.children
set nickname = 'Owner Updated'
where id = (select owner_child_id from test_context);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select parent_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select parent_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 1
   from public.households h
   join test_context t on h.id = t.household_a_id),
  'parent must be able to read its household'
);

insert into public.children (household_id, name, nickname)
select household_a_id, 'Parent Child', 'Parent'
from test_context
returning id \gset parent_child_

update test_context
set parent_child_id = :'parent_child_id'::uuid;

update public.children
set name = 'Parent Updated Child',
    nickname = 'Parent Updated'
where id = (select owner_child_id from test_context);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.add_household_member(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.outsider_user_id,
      'parent'
    ),
    'parent cannot add a household member'
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 3
   from public.household_members hm
   join test_context t on hm.household_id = t.household_a_id),
  'failed parent RPC must not add a member'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select viewer_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select viewer_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 2
   from public.children c
   join test_context t on c.household_id = t.household_a_id),
  'viewer must be able to read household children'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'insert into public.children (household_id, name) values (%L::uuid, %L)',
      t.household_a_id,
      'Viewer Must Fail'
    ),
    'viewer cannot create a child'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'update public.children set name = %L where id = %L::uuid',
      'Viewer Must Fail',
      t.owner_child_id
    ),
    'viewer cannot update a child'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'delete from public.children where id = %L::uuid',
      t.owner_child_id
    ),
    'viewer cannot delete a child'
  );
  perform pg_temp.expect_error(
    format(
      'select public.set_household_member_role(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.viewer_user_id,
      'parent'
    ),
    'viewer cannot change household roles'
  );
end;
$$;

select pg_temp.assert_true(
  (select c.name = 'Parent Updated Child'
          and c.nickname = 'Parent Updated'
   from public.children c
   join test_context t on c.id = t.owner_child_id),
  'viewer rejected writes must leave the child unchanged and present'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select outsider_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select outsider_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

with created as (
  select id from public.create_household('Local Household B')
)
update test_context t
set household_b_id = created.id
from created;

insert into public.children (household_id, name, nickname)
select household_b_id, 'Outsider Child', 'Outsider'
from test_context
returning id \gset outsider_child_

update test_context
set outsider_child_id = :'outsider_child_id'::uuid;

select pg_temp.assert_true(
  (select count(*) = 0
   from public.households h
   join test_context t on h.id = t.household_a_id),
  'Household B owner must not see Household A'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.household_members hm
   join test_context t on hm.household_id = t.household_a_id),
  'Household B owner must not see Household A memberships'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.children c
   join test_context t on c.household_id = t.household_a_id),
  'Household B owner must not see Household A children'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'insert into public.children (household_id, name) values (%L::uuid, %L)',
      t.household_a_id,
      'B to A Insert Must Fail'
    ),
    'Household B to A child insert'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'update public.children set name = %L where id = %L::uuid',
      'B to A Update Must Fail',
      t.owner_child_id
    ),
    'Household B to A child update'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'delete from public.children where id = %L::uuid',
      t.owner_child_id
    ),
    'Household B to A child delete'
  );
  perform pg_temp.expect_error(
    format(
      'select public.add_household_member(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.outsider_user_id,
      'parent'
    ),
    'Household B owner cannot add a member to Household A'
  );
  perform pg_temp.expect_error(
    format(
      'select public.set_household_member_role(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.parent_user_id,
      'viewer'
    ),
    'Household B owner cannot change a Household A role'
  );
  perform pg_temp.expect_error(
    format(
      'select public.remove_household_member(%L::uuid, %L::uuid)',
      t.household_a_id,
      t.parent_user_id
    ),
    'Household B owner cannot remove a Household A member'
  );
  perform pg_temp.expect_error(
    format(
      'select public.transfer_household_ownership(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.parent_user_id,
      'parent'
    ),
    'Household B owner cannot transfer Household A ownership'
  );
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select owner_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 0
   from public.households h
   join test_context t on h.id = t.household_b_id),
  'another household must not be visible'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.household_members hm
   join test_context t on hm.household_id = t.household_b_id),
  'another household memberships must not be visible'
);
select pg_temp.assert_true(
  (select count(*) = 0
   from public.children c
   join test_context t on c.household_id = t.household_b_id),
  'another household children must not be visible'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'insert into public.children (household_id, name) values (%L::uuid, %L)',
      t.household_b_id,
      'Cross Household Must Fail'
    ),
    'cross-household child insert'
  );
  perform pg_temp.expect_error(
    format(
      'select public.add_household_member(%L::uuid, %L::uuid, %L)',
      t.household_b_id,
      t.owner_user_id,
      'parent'
    ),
    'cross-household member RPC'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'update public.children set name = %L where id = %L::uuid',
      'A to B Update Must Fail',
      t.outsider_child_id
    ),
    'Household A to B child update'
  );
  perform pg_temp.assert_write_rejected(
    format(
      'delete from public.children where id = %L::uuid',
      t.outsider_child_id
    ),
    'Household A to B child delete'
  );
  perform pg_temp.expect_error(
    format(
      'select public.set_household_member_role(%L::uuid, %L::uuid, %L)',
      t.household_b_id,
      t.outsider_user_id,
      'parent'
    ),
    'Household A owner cannot change a Household B role'
  );
  perform pg_temp.expect_error(
    format(
      'select public.remove_household_member(%L::uuid, %L::uuid)',
      t.household_b_id,
      t.outsider_user_id
    ),
    'Household A owner cannot remove a Household B member'
  );
  perform pg_temp.expect_error(
    format(
      'select public.transfer_household_ownership(%L::uuid, %L::uuid, %L)',
      t.household_b_id,
      t.outsider_user_id,
      'parent'
    ),
    'Household A owner cannot transfer Household B ownership'
  );
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select outsider_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select outsider_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select c.name = 'Outsider Child'
   from public.children c
   join test_context t on c.id = t.outsider_child_id),
  'cross-household update must leave the target row unchanged'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select owner_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select c.name = 'Parent Updated Child'
          and c.nickname = 'Parent Updated'
   from public.children c
   join test_context t on c.id = t.owner_child_id),
  'Household B rejected writes must leave Household A data unchanged'
);

select public.transfer_household_ownership(
  (select household_a_id from test_context),
  (select viewer_user_id from test_context),
  'parent'
);

do $$
declare
  t test_context%rowtype;
begin
  select * into t from test_context;
  perform pg_temp.expect_error(
    format(
      'select public.transfer_household_ownership(%L::uuid, %L::uuid, %L)',
      t.household_a_id,
      t.viewer_user_id,
      'parent'
    ),
    'former owner cannot repeat ownership transfer'
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 1
   from public.household_members hm
   join test_context t
     on hm.household_id = t.household_a_id
    and hm.user_id = t.viewer_user_id
   where hm.role = 'owner')
  and
  (select count(*) = 1
   from public.household_members hm
   join test_context t
     on hm.household_id = t.household_a_id
    and hm.user_id = t.owner_user_id
   where hm.role = 'parent'),
  'failed repeated transfer must not partially change member roles'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select viewer_user_id::text from test_context),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select viewer_user_id from test_context),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.transfer_household_ownership(
  (select household_a_id from test_context),
  (select owner_user_id from test_context),
  'viewer'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.household_members hm
   join test_context t
     on hm.household_id = t.household_a_id
    and hm.user_id = t.owner_user_id
   where hm.role = 'owner')
  and
  (select count(*) = 1
   from public.household_members hm
   join test_context t
     on hm.household_id = t.household_a_id
    and hm.user_id = t.viewer_user_id
   where hm.role = 'viewer'),
  'ownership transfer and transfer-back must preserve intended roles'
);

reset role;
rollback;

\echo 'PASS: local RPC and RLS tests rolled back all test data'
