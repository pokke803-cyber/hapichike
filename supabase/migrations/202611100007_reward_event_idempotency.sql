begin;

create table if not exists public.reward_mutation_events (
  event_id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  action_type text not null check (action_type in ('ticket', 'star_coin', 'star_exchange', 'pay', 'happy_chance')),
  amount integer not null check (amount <> 0),
  pay_type text null check (pay_type is null or pay_type in ('sweets', 'toy', 'game')),
  created_at timestamptz not null default now()
);

alter table public.reward_mutation_events enable row level security;
revoke all on table public.reward_mutation_events from public, anon, authenticated;

create function public.claim_reward_mutation_event(
  p_event_id uuid, p_child_id uuid, p_action_type text, p_amount integer, p_pay_type text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_household_id uuid;
  v_existing public.reward_mutation_events%rowtype;
begin
  if p_event_id is null then raise exception 'event id is required'; end if;
  if p_child_id is null then raise exception 'child id is required'; end if;
  if p_action_type not in ('ticket', 'star_coin', 'star_exchange', 'pay', 'happy_chance') then raise exception 'invalid action type'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'amount must be non-zero'; end if;
  if (p_action_type = 'pay' and (p_pay_type is null or p_pay_type not in ('sweets', 'toy', 'game')))
    or (p_action_type <> 'pay' and p_pay_type is not null) then raise exception 'invalid pay type'; end if;

  select c.household_id into v_household_id
  from public.children c
  join public.household_members hm on hm.household_id = c.household_id
    and hm.user_id = auth.uid() and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;
  if v_household_id is null then raise exception 'not authorized to update child rewards'; end if;

  insert into public.reward_mutation_events(event_id, household_id, child_id, action_type, amount, pay_type)
  values (p_event_id, v_household_id, p_child_id, p_action_type, p_amount, p_pay_type)
  on conflict (event_id) do nothing;
  if found then return true; end if;

  select * into v_existing from public.reward_mutation_events where event_id = p_event_id;
  if v_existing.household_id <> v_household_id or v_existing.child_id <> p_child_id
    or v_existing.action_type <> p_action_type or v_existing.amount <> p_amount
    or v_existing.pay_type is distinct from p_pay_type then
    raise exception 'event id conflicts with a different reward mutation';
  end if;
  return false;
end;
$$;

revoke all on function public.claim_reward_mutation_event(uuid, uuid, text, integer, text) from public, anon, authenticated;

create function public.add_ticket(p_child_id uuid, p_amount integer, p_event_id uuid, p_title text default null, p_message text default null, p_metadata jsonb default '{}'::jsonb)
returns public.child_balances language plpgsql security definer set search_path = '' set row_security = off as $$
declare v_claimed boolean; v_balance public.child_balances%rowtype;
begin
  v_claimed := public.claim_reward_mutation_event(p_event_id, p_child_id, 'ticket', p_amount, null);
  if not v_claimed then select * into strict v_balance from public.child_balances where child_id = p_child_id; return v_balance; end if;
  return public.add_ticket(p_child_id, p_amount, p_title, p_message, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_id', p_event_id));
end; $$;

create function public.add_star_coin(p_child_id uuid, p_amount integer, p_event_id uuid, p_title text default null, p_message text default null, p_metadata jsonb default '{}'::jsonb)
returns public.child_balances language plpgsql security definer set search_path = '' set row_security = off as $$
declare v_claimed boolean; v_balance public.child_balances%rowtype;
begin
  v_claimed := public.claim_reward_mutation_event(p_event_id, p_child_id, 'star_coin', p_amount, null);
  if not v_claimed then select * into strict v_balance from public.child_balances where child_id = p_child_id; return v_balance; end if;
  return public.add_star_coin(p_child_id, p_amount, p_title, p_message, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_id', p_event_id));
end; $$;

create function public.exchange_star_coins_for_ticket(p_child_id uuid, p_event_id uuid, p_title text default null, p_message text default null, p_metadata jsonb default '{}'::jsonb)
returns public.child_balances language plpgsql security definer set search_path = '' set row_security = off as $$
declare v_claimed boolean; v_balance public.child_balances%rowtype;
begin
  v_claimed := public.claim_reward_mutation_event(p_event_id, p_child_id, 'star_exchange', 1, null);
  if not v_claimed then select * into strict v_balance from public.child_balances where child_id = p_child_id; return v_balance; end if;
  return public.exchange_star_coins_for_ticket(p_child_id, p_title, p_message, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_id', p_event_id));
end; $$;

create function public.adjust_pay_balance(p_child_id uuid, p_pay_type text, p_amount integer, p_event_id uuid, p_title text default null, p_message text default null, p_metadata jsonb default '{}'::jsonb)
returns public.child_balances language plpgsql security definer set search_path = '' set row_security = off as $$
declare v_claimed boolean; v_balance public.child_balances%rowtype;
begin
  v_claimed := public.claim_reward_mutation_event(p_event_id, p_child_id, 'pay', p_amount, p_pay_type);
  if not v_claimed then select * into strict v_balance from public.child_balances where child_id = p_child_id; return v_balance; end if;
  return public.adjust_pay_balance(p_child_id, p_pay_type, p_amount, p_title, p_message, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_id', p_event_id));
end; $$;

create function public.adjust_happy_chance(p_child_id uuid, p_amount integer, p_event_id uuid, p_title text default null, p_message text default null, p_metadata jsonb default '{}'::jsonb)
returns public.child_balances language plpgsql security definer set search_path = '' set row_security = off as $$
declare v_claimed boolean; v_balance public.child_balances%rowtype;
begin
  v_claimed := public.claim_reward_mutation_event(p_event_id, p_child_id, 'happy_chance', p_amount, null);
  if not v_claimed then select * into strict v_balance from public.child_balances where child_id = p_child_id; return v_balance; end if;
  return public.adjust_happy_chance(p_child_id, p_amount, p_title, p_message, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_id', p_event_id));
end; $$;

revoke all on function public.add_ticket(uuid, integer, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.add_star_coin(uuid, integer, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.exchange_star_coins_for_ticket(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.adjust_pay_balance(uuid, text, integer, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.adjust_happy_chance(uuid, integer, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.add_ticket(uuid, integer, uuid, text, text, jsonb) to authenticated;
grant execute on function public.add_star_coin(uuid, integer, uuid, text, text, jsonb) to authenticated;
grant execute on function public.exchange_star_coins_for_ticket(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.adjust_pay_balance(uuid, text, integer, uuid, text, text, jsonb) to authenticated;
grant execute on function public.adjust_happy_chance(uuid, integer, uuid, text, text, jsonb) to authenticated;

commit;
