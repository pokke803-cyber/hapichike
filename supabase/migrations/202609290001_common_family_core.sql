begin;

-- Shared family/auth foundation only. Do not add app-specific objects here.

do $preflight$
declare
  profile_policy_count integer;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'preflight failed: public.profiles does not exist';
  end if;

  if to_regclass('public.children') is null then
    raise exception 'preflight failed: public.children does not exist';
  end if;

  if to_regclass('public.households') is not null then
    raise exception 'preflight failed: public.households already exists';
  end if;

  if to_regclass('public.household_members') is not null then
    raise exception 'preflight failed: public.household_members already exists';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_id_fkey'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid, true)
        = 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'
  ) then
    raise exception 'preflight failed: profiles_id_fkey does not match the expected definition';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'display_name'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) then
    raise exception 'preflight failed: profiles.display_name must be nullable text';
  end if;

  if exists (
    select 1
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  ) then
    raise exception 'preflight failed: an auth user without a public.profiles row exists';
  end if;

  select count(*)
  into profile_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname in (
      'Users can view own profile',
      'Users can insert own profile',
      'Users can update own profile'
    );

  if profile_policy_count <> 3 then
    raise exception 'preflight failed: expected 3 known profiles policies; found %', profile_policy_count;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname not in (
        'Users can view own profile',
        'Users can insert own profile',
        'Users can update own profile'
      )
  ) then
    raise exception 'preflight failed: an unexpected profiles policy exists';
  end if;

  if to_regprocedure('public.is_household_member(uuid)') is not null then
    raise exception 'preflight failed: public.is_household_member(uuid) already exists';
  end if;

  if to_regprocedure('public.has_household_role(uuid,text[])') is not null then
    raise exception 'preflight failed: public.has_household_role(uuid,text[]) already exists';
  end if;
end
$preflight$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null
    references public.households(id) on delete cascade,
  user_id uuid not null
    references public.profiles(id) on delete restrict,
  role text not null,
  created_at timestamptz not null default now(),
  constraint household_members_pkey primary key (household_id, user_id),
  constraint household_members_role_check
    check (role in ('owner', 'parent', 'viewer'))
);

create index household_members_user_id_idx
  on public.household_members(user_id);

-- These SECURITY DEFINER helpers are owned by the migration role. They bypass
-- household_members RLS so that policies on that table cannot recurse.
create function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    auth.uid() is not null
    and p_household_id is not null
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = p_household_id
        and hm.user_id = auth.uid()
    );
$$;

create function public.has_household_role(
  p_household_id uuid,
  p_allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    auth.uid() is not null
    and p_household_id is not null
    and p_allowed_roles is not null
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = p_household_id
        and hm.user_id = auth.uid()
        and hm.role = any (p_allowed_roles)
    );
$$;

-- A newly-created household must have an owner by transaction commit. The
-- deferred check lets create_household insert the household before membership.
create function public.ensure_new_household_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if exists (
    select 1
    from public.households h
    where h.id = new.id
  ) and not exists (
    select 1
    from public.household_members hm
    where hm.household_id = new.id
      and hm.role = 'owner'
  ) then
    raise exception 'household must have at least one owner';
  end if;

  return new;
end;
$$;

create constraint trigger households_require_owner
after insert on public.households
deferrable initially deferred
for each row
execute function public.ensure_new_household_has_owner();

-- Protect the owner invariant even if a privileged caller writes outside the
-- public RPCs. Household deletion remains possible because the parent row no
-- longer exists when its memberships are removed by ON DELETE CASCADE.
create function public.prevent_last_household_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  checked_household_id uuid;
begin
  if tg_op = 'DELETE' then
    checked_household_id := old.household_id;
  elsif old.household_id is distinct from new.household_id
     or (
       old.role = 'owner'
       and new.role is distinct from 'owner'
     ) then
    checked_household_id := old.household_id;
  else
    return new;
  end if;

  if exists (
    select 1
    from public.households h
    where h.id = checked_household_id
  ) and not exists (
    select 1
    from public.household_members hm
    where hm.household_id = checked_household_id
      and hm.role = 'owner'
  ) then
    raise exception 'cannot remove or demote the last household owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create constraint trigger household_members_preserve_owner
after update or delete on public.household_members
deferrable initially deferred
for each row
execute function public.prevent_last_household_owner_loss();

create function public.create_household(p_name text)
returns public.households
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  created_household public.households;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'household name is required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
  ) then
    raise exception 'profile is required before creating a household';
  end if;

  insert into public.households (name)
  values (btrim(p_name))
  returning * into created_household;

  insert into public.household_members (household_id, user_id, role)
  values (created_household.id, auth.uid(), 'owner');

  return created_household;
end;
$$;

create function public.add_household_member(
  p_household_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  added_member public.household_members;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_role is null or p_role not in ('owner', 'parent', 'viewer') then
    raise exception 'invalid household role';
  end if;

  perform 1
  from public.households h
  where h.id = p_household_id
  for update;

  if not found then
    raise exception 'household not found';
  end if;

  if not public.has_household_role(
    p_household_id,
    array['owner']::text[]
  ) then
    raise exception 'only a household owner may add members';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
  ) then
    raise exception 'target profile not found';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (p_household_id, p_user_id, p_role)
  returning * into added_member;

  return added_member;
end;
$$;

create function public.set_household_member_role(
  p_household_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  changed_member public.household_members;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_role is null or p_role not in ('owner', 'parent', 'viewer') then
    raise exception 'invalid household role';
  end if;

  perform 1
  from public.households h
  where h.id = p_household_id
  for update;

  if not found then
    raise exception 'household not found';
  end if;

  if not public.has_household_role(
    p_household_id,
    array['owner']::text[]
  ) then
    raise exception 'only a household owner may change member roles';
  end if;

  select hm.*
  into changed_member
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'household member not found';
  end if;

  if changed_member.role = 'owner'
     and p_role <> 'owner'
     and not exists (
       select 1
       from public.household_members other_owner
       where other_owner.household_id = p_household_id
         and other_owner.role = 'owner'
         and other_owner.user_id <> p_user_id
     ) then
    raise exception 'cannot demote the last household owner';
  end if;

  update public.household_members hm
  set role = p_role
  where hm.household_id = p_household_id
    and hm.user_id = p_user_id
  returning * into changed_member;

  return changed_member;
end;
$$;

create function public.remove_household_member(
  p_household_id uuid,
  p_user_id uuid
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  removed_member public.household_members;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform 1
  from public.households h
  where h.id = p_household_id
  for update;

  if not found then
    raise exception 'household not found';
  end if;

  if not public.has_household_role(
    p_household_id,
    array['owner']::text[]
  ) then
    raise exception 'only a household owner may remove members';
  end if;

  select hm.*
  into removed_member
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = p_user_id
  for update;

  if not found then
    raise exception 'household member not found';
  end if;

  if removed_member.role = 'owner'
     and not exists (
       select 1
       from public.household_members other_owner
       where other_owner.household_id = p_household_id
         and other_owner.role = 'owner'
         and other_owner.user_id <> p_user_id
     ) then
    raise exception 'cannot remove the last household owner';
  end if;

  delete from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = p_user_id
  returning * into removed_member;

  return removed_member;
end;
$$;

-- Atomically promote another existing member and demote the calling owner.
create function public.transfer_household_ownership(
  p_household_id uuid,
  p_new_owner_user_id uuid,
  p_previous_owner_role text default 'parent'
)
returns public.household_members
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  new_owner public.household_members;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_previous_owner_role is null
     or p_previous_owner_role not in ('parent', 'viewer') then
    raise exception 'previous owner role must be parent or viewer';
  end if;

  if p_new_owner_user_id = auth.uid() then
    raise exception 'new owner must be a different household member';
  end if;

  perform 1
  from public.households h
  where h.id = p_household_id
  for update;

  if not found then
    raise exception 'household not found';
  end if;

  if not public.has_household_role(
    p_household_id,
    array['owner']::text[]
  ) then
    raise exception 'only a household owner may transfer ownership';
  end if;

  select hm.*
  into new_owner
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = p_new_owner_user_id
  for update;

  if not found then
    raise exception 'new owner must already be a household member';
  end if;

  update public.household_members hm
  set role = 'owner'
  where hm.household_id = p_household_id
    and hm.user_id = p_new_owner_user_id
  returning * into new_owner;

  update public.household_members hm
  set role = p_previous_owner_role
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid();

  if not found then
    raise exception 'calling owner membership not found';
  end if;

  return new_owner;
end;
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy "Users can view own profile" on public.profiles;
drop policy "Users can insert own profile" on public.profiles;
drop policy "Users can update own profile" on public.profiles;

create policy profiles_select_self
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy households_select_members
on public.households
for select
to authenticated
using (public.is_household_member(id));

create policy household_members_select_members
on public.household_members
for select
to authenticated
using (public.is_household_member(household_id));

-- Direct table access is deliberately narrower than the RPC surface.
revoke all on public.profiles from anon, authenticated;
revoke select (id, display_name, created_at),
  insert (id, display_name, created_at),
  update (id, display_name, created_at),
  references (id, display_name, created_at)
  on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

revoke all on public.households from anon, authenticated;
revoke all on public.household_members from anon, authenticated;
grant select on public.households to authenticated;
grant select on public.household_members to authenticated;

revoke all on function public.ensure_new_household_has_owner()
  from public, anon, authenticated;
revoke all on function public.prevent_last_household_owner_loss()
  from public, anon, authenticated;

revoke all on function public.is_household_member(uuid)
  from public, anon, authenticated;
revoke all on function public.has_household_role(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.has_household_role(uuid, text[]) to authenticated;

revoke all on function public.create_household(text)
  from public, anon, authenticated;
revoke all on function public.add_household_member(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_household_member_role(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.remove_household_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_household_ownership(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.add_household_member(uuid, uuid, text) to authenticated;
grant execute on function public.set_household_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_household_ownership(uuid, uuid, text) to authenticated;

commit;
