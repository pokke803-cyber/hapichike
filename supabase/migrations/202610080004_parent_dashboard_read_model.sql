begin;

do $preflight$
begin
  if to_regclass('public.children') is null then
    raise exception 'preflight failed: public.children does not exist';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'children'
      and column_name = 'display_order'
  ) then
    raise exception 'preflight failed: children.display_order already exists';
  end if;

  if to_regclass('public.child_balances') is not null then
    raise exception 'preflight failed: public.child_balances already exists';
  end if;

  if to_regclass('public.reward_logs') is not null then
    raise exception 'preflight failed: public.reward_logs already exists';
  end if;
end
$preflight$;

alter table public.children
  add column display_order integer not null default 0,
  add constraint children_display_order_check check (display_order >= 0);

-- This replaces the narrower household-only index while preserving its prefix.
drop index public.children_household_id_idx;
create index children_household_display_order_idx
  on public.children(household_id, display_order, created_at, id);

create table public.child_balances (
  child_id uuid primary key
    references public.children(id) on delete cascade,
  tickets integer not null default 0,
  star_coins integer not null default 0,
  sweets_pay integer not null default 0,
  toy_pay integer not null default 0,
  game_pay integer not null default 0,
  happy_chance_cards integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing local data can contain negative ticket/PAY values. The read model
-- deliberately does not add non-negative checks that would reject such data.
insert into public.child_balances (child_id)
select c.id
from public.children c
on conflict (child_id) do nothing;

create function public.create_initial_child_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  insert into public.child_balances (child_id)
  values (new.id);
  return new;
end;
$$;

create trigger children_create_initial_balance
after insert on public.children
for each row
execute function public.create_initial_child_balance();

create function public.set_child_balance_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger child_balances_set_updated_at
before update on public.child_balances
for each row
execute function public.set_child_balance_updated_at();

create table public.reward_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households(id) on delete restrict,
  child_id uuid not null
    references public.children(id) on delete restrict,
  type text not null,
  title text,
  message text,
  amount integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.validate_reward_log_child_household()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if not exists (
    select 1
    from public.children c
    where c.id = new.child_id
      and c.household_id = new.household_id
  ) then
    raise exception 'reward log child must belong to the specified household';
  end if;

  return new;
end;
$$;

create trigger reward_logs_validate_child_household
before insert or update of household_id, child_id on public.reward_logs
for each row
execute function public.validate_reward_log_child_household();

create index reward_logs_child_created_at_idx
  on public.reward_logs(child_id, created_at desc);
create index reward_logs_household_created_at_idx
  on public.reward_logs(household_id, created_at desc);

alter table public.child_balances enable row level security;
alter table public.reward_logs enable row level security;

create policy child_balances_select_household_members
on public.child_balances
for select
to authenticated
using (
  exists (
    select 1
    from public.children c
    where c.id = child_balances.child_id
      and public.is_household_member(c.household_id)
  )
);

create policy reward_logs_select_household_members
on public.reward_logs
for select
to authenticated
using (public.is_household_member(household_id));

revoke all on public.child_balances, public.reward_logs
  from public, anon, authenticated;
grant select on public.child_balances, public.reward_logs
  to authenticated;
grant all on public.child_balances, public.reward_logs
  to service_role;

revoke all on function public.create_initial_child_balance()
  from public, anon, authenticated;
revoke all on function public.set_child_balance_updated_at()
  from public, anon, authenticated;
revoke all on function public.validate_reward_log_child_household()
  from public, anon, authenticated;

commit;
