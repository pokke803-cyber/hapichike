begin;

do $preflight$
begin
  if to_regclass('public.children') is null then
    raise exception 'preflight failed: public.children does not exist';
  end if;
  if to_regclass('public.child_balances') is null then
    raise exception 'preflight failed: public.child_balances does not exist';
  end if;
  if to_regclass('public.reward_logs') is null then
    raise exception 'preflight failed: public.reward_logs does not exist';
  end if;
  if to_regclass('public.child_app_sync_state') is not null then
    raise exception 'preflight failed: public.child_app_sync_state already exists';
  end if;
  if to_regprocedure('public.import_initial_hapichike_snapshot(uuid,uuid,integer,text,integer,integer,integer,integer,integer,integer,timestamptz,boolean,text,jsonb)') is not null then
    raise exception 'preflight failed: public.import_initial_hapichike_snapshot already exists';
  end if;
end
$preflight$;

create table public.child_app_sync_state (
  child_id uuid not null
    references public.children(id) on delete cascade,
  app_id text not null,
  initial_import_id uuid,
  initial_import_completed_at timestamptz,
  import_version integer,
  source_snapshot_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (child_id, app_id),
  constraint child_app_sync_state_app_id_check
    check (app_id = 'hapichike'),
  constraint child_app_sync_state_import_version_check
    check (import_version is null or import_version > 0),
  constraint child_app_sync_state_snapshot_hash_check
    check (source_snapshot_hash is null or source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint child_app_sync_state_completed_fields_check
    check (
      initial_import_completed_at is null
      or (
        initial_import_id is not null
        and import_version is not null
        and source_snapshot_hash is not null
      )
    )
);

create unique index child_app_sync_state_import_id_uidx
  on public.child_app_sync_state(app_id, initial_import_id)
  where initial_import_id is not null;

create function public.set_child_app_sync_state_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger child_app_sync_state_set_updated_at
before update on public.child_app_sync_state
for each row
execute function public.set_child_app_sync_state_updated_at();

alter table public.child_app_sync_state enable row level security;

-- Sync readiness is read-only household information, like child_balances. This
-- intentionally lets viewers inspect it while writes remain RPC-only.
create policy child_app_sync_state_select_household_members
on public.child_app_sync_state
for select
to authenticated
using (
  exists (
    select 1
    from public.children c
    where c.id = child_app_sync_state.child_id
      and public.is_household_member(c.household_id)
  )
);

revoke all on public.child_app_sync_state
  from public, anon, authenticated;
grant select on public.child_app_sync_state to authenticated;
grant all on public.child_app_sync_state to service_role;

create function public.import_initial_hapichike_snapshot(
  p_child_id uuid,
  p_import_id uuid,
  p_import_version integer,
  p_source_snapshot_hash text,
  p_tickets integer,
  p_star_coins integer,
  p_sweets_pay integer,
  p_toy_pay integer,
  p_game_pay integer,
  p_happy_chance_cards integer,
  p_backup_created_at timestamptz,
  p_parent_approved boolean,
  p_title text default '初回データ移行',
  p_metadata jsonb default '{}'::jsonb
)
returns public.child_balances
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_household_id uuid;
  v_balance public.child_balances%rowtype;
  v_sync_state public.child_app_sync_state%rowtype;
  v_existing_snapshot jsonb;
  v_snapshot jsonb;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_import_id is null then
    raise exception 'import id is required';
  end if;
  if p_import_version is null or p_import_version <> 1 then
    raise exception 'unsupported import version';
  end if;
  if p_source_snapshot_hash is null
     or p_source_snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'snapshot hash must be a lowercase SHA-256 hex digest';
  end if;
  if p_tickets is null
     or p_star_coins is null
     or p_sweets_pay is null
     or p_toy_pay is null
     or p_game_pay is null
     or p_happy_chance_cards is null then
    raise exception 'all six snapshot balances are required';
  end if;
  if p_star_coins < 0 then
    raise exception 'star coin balance cannot be negative';
  end if;
  if p_happy_chance_cards < 0 then
    raise exception 'happy chance balance cannot be negative';
  end if;
  if p_parent_approved is not true then
    raise exception 'explicit parent approval is required';
  end if;
  if p_backup_created_at is null then
    raise exception 'a verified backup timestamp is required';
  end if;
  if p_backup_created_at > now() + interval '5 minutes' then
    raise exception 'backup timestamp cannot be in the future';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  -- Lock the child first so concurrent first-import attempts for the same child
  -- serialize even before a sync-state row exists.
  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for update of c;

  if v_household_id is null then
    raise exception 'not authorized to import child snapshot';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;

  select s.*
    into v_sync_state
  from public.child_app_sync_state s
  where s.child_id = p_child_id
    and s.app_id = 'hapichike'
  for update;

  v_snapshot := jsonb_build_object(
    'tickets', p_tickets,
    'star_coins', p_star_coins,
    'sweets_pay', p_sweets_pay,
    'toy_pay', p_toy_pay,
    'game_pay', p_game_pay,
    'happy_chance_cards', p_happy_chance_cards
  );

  if v_sync_state.initial_import_completed_at is not null then
    if v_sync_state.initial_import_id = p_import_id then
      select r.metadata -> 'snapshot'
        into v_existing_snapshot
      from public.reward_logs r
      where r.child_id = p_child_id
        and r.type = 'initial_import'
        and r.metadata ->> 'app_id' = 'hapichike'
        and r.metadata ->> 'import_id' = p_import_id::text
      order by r.created_at
      limit 1;

      if v_sync_state.import_version = p_import_version
         and v_sync_state.source_snapshot_hash = p_source_snapshot_hash
         and v_existing_snapshot = v_snapshot then
        return v_balance;
      end if;

      raise exception 'import id was already used with a different payload';
    end if;

    if v_sync_state.source_snapshot_hash = p_source_snapshot_hash then
      raise exception 'snapshot was already imported with a different import id';
    end if;

    raise exception 'initial import is already complete';
  end if;

  if found
     and (
       v_sync_state.initial_import_id is not null
       or v_sync_state.import_version is not null
       or v_sync_state.source_snapshot_hash is not null
     ) then
    raise exception 'incomplete sync state requires manual review';
  end if;

  -- Zero balances alone are insufficient. Any prior reward history means the
  -- cloud child has already been used and must go through reconciliation.
  if v_balance.tickets <> 0
     or v_balance.star_coins <> 0
     or v_balance.sweets_pay <> 0
     or v_balance.toy_pay <> 0
     or v_balance.game_pay <> 0
     or v_balance.happy_chance_cards <> 0
     or exists (
       select 1
       from public.reward_logs r
       where r.child_id = p_child_id
     ) then
    raise exception 'cloud child is already initialized';
  end if;

  update public.child_balances cb
  set tickets = p_tickets,
      star_coins = p_star_coins,
      sweets_pay = p_sweets_pay,
      toy_pay = p_toy_pay,
      game_pay = p_game_pay,
      happy_chance_cards = p_happy_chance_cards
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  insert into public.child_app_sync_state (
    child_id,
    app_id,
    initial_import_id,
    initial_import_completed_at,
    import_version,
    source_snapshot_hash
  ) values (
    p_child_id,
    'hapichike',
    p_import_id,
    now(),
    p_import_version,
    p_source_snapshot_hash
  );

  insert into public.reward_logs (
    household_id,
    child_id,
    type,
    title,
    message,
    amount,
    metadata
  ) values (
    v_household_id,
    p_child_id,
    'initial_import',
    coalesce(p_title, '初回データ移行'),
    null,
    null,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'app_id', 'hapichike',
      'import_id', p_import_id,
      'import_version', p_import_version,
      'snapshot_hash', p_source_snapshot_hash,
      'source', 'legacy_localstorage',
      'backup_created_at', p_backup_created_at,
      'approved_by', auth.uid(),
      'snapshot', v_snapshot
    )
  );

  return v_balance;
end;
$$;

revoke all on function public.set_child_app_sync_state_updated_at()
  from public, anon, authenticated;
revoke all on function public.import_initial_hapichike_snapshot(uuid, uuid, integer, text, integer, integer, integer, integer, integer, integer, timestamptz, boolean, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.import_initial_hapichike_snapshot(uuid, uuid, integer, text, integer, integer, integer, integer, integer, integer, timestamptz, boolean, text, jsonb)
  to authenticated;

commit;
