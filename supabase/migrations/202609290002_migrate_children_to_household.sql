begin;

-- Abort rather than attempting a lossy parent_id-to-household_id conversion.
do $preflight$
declare
  children_count bigint;
  children_policy_count integer;
begin
  if to_regclass('public.children') is null then
    raise exception 'preflight failed: public.children does not exist';
  end if;

  if to_regclass('public.households') is null then
    raise exception 'preflight failed: public.households does not exist';
  end if;

  if to_regclass('public.household_members') is null then
    raise exception 'preflight failed: public.household_members does not exist';
  end if;

  select count(*) into children_count from public.children;

  if children_count <> 0 then
    raise exception
      'preflight failed: public.children must be empty; found % row(s)',
      children_count;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'children'
      and column_name = 'parent_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'preflight failed: children.parent_id uuid does not exist';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'children'
      and column_name = 'household_id'
  ) then
    raise exception 'preflight failed: children.household_id already exists';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.children'::regclass
      and c.conname = 'children_parent_id_fkey'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid, true)
        = 'FOREIGN KEY (parent_id) REFERENCES profiles(id) ON DELETE CASCADE'
  ) then
    raise exception 'preflight failed: children_parent_id_fkey does not match the expected definition';
  end if;

  select count(*)
  into children_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'children'
    and policyname in (
      'Users can view own children',
      'Users can insert own children',
      'Users can update own children'
    );

  if children_policy_count <> 3 then
    raise exception
      'preflight failed: expected 3 known children policies; found %',
      children_policy_count;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'children'
      and policyname not in (
        'Users can view own children',
        'Users can insert own children',
        'Users can update own children'
      )
  ) then
    raise exception 'preflight failed: an unexpected children policy exists';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.children'::regclass
      and not t.tgisinternal
  ) then
    raise exception 'preflight failed: an unexpected children trigger exists';
  end if;

  if exists (
    select 1
    from pg_constraint c
    where c.confrelid = 'public.children'::regclass
      and c.contype = 'f'
  ) then
    raise exception 'preflight failed: another table has a foreign key to public.children';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and (
        pg_get_functiondef(p.oid) ilike '%parent_id%'
        or pg_get_functiondef(p.oid) ilike '%public.children%'
      )
  ) then
    raise exception 'preflight failed: a function or procedure references children.parent_id or public.children';
  end if;

  if exists (
    select 1
    from pg_views v
    where v.schemaname not in ('pg_catalog', 'information_schema')
      and (
        v.definition ilike '%parent_id%'
        or v.definition ilike '%public.children%'
      )
  ) or exists (
    select 1
    from pg_matviews v
    where v.schemaname not in ('pg_catalog', 'information_schema')
      and (
        v.definition ilike '%parent_id%'
        or v.definition ilike '%public.children%'
      )
  ) then
    raise exception 'preflight failed: a view references children.parent_id or public.children';
  end if;
end
$preflight$;

alter table public.children
  add column household_id uuid;

drop policy "Users can view own children" on public.children;
drop policy "Users can insert own children" on public.children;
drop policy "Users can update own children" on public.children;

alter table public.children
  drop constraint children_parent_id_fkey;

alter table public.children
  drop column parent_id;

alter table public.children
  alter column name set not null,
  alter column household_id set not null;

alter table public.children
  add constraint children_household_id_fkey
  foreign key (household_id)
  references public.households(id)
  on delete restrict;

create index children_household_id_idx
  on public.children(household_id);

alter table public.children enable row level security;

create policy children_select_household_members
on public.children
for select
to authenticated
using (public.is_household_member(household_id));

create policy children_insert_household_parents
on public.children
for insert
to authenticated
with check (
  public.has_household_role(
    household_id,
    array['owner', 'parent']::text[]
  )
);

create policy children_update_household_parents
on public.children
for update
to authenticated
using (
  public.has_household_role(
    household_id,
    array['owner', 'parent']::text[]
  )
)
with check (
  public.has_household_role(
    household_id,
    array['owner', 'parent']::text[]
  )
);

revoke all on public.children from anon, authenticated;
revoke select (id, household_id, name, nickname, created_at),
  insert (id, household_id, name, nickname, created_at),
  update (id, household_id, name, nickname, created_at),
  references (id, household_id, name, nickname, created_at)
  on public.children from anon, authenticated;
grant select on public.children to authenticated;
grant insert (household_id, name, nickname)
  on public.children to authenticated;
grant update (name, nickname)
  on public.children to authenticated;

commit;
