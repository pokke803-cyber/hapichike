begin;

do $preflight$
begin
  if to_regclass('public.child_balances') is null then
    raise exception 'preflight failed: public.child_balances does not exist';
  end if;

  if to_regclass('public.reward_logs') is null then
    raise exception 'preflight failed: public.reward_logs does not exist';
  end if;
end
$preflight$;

create function public.add_ticket(
  p_child_id uuid,
  p_amount integer,
  p_title text default null,
  p_message text default null,
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
  v_previous integer;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be non-zero';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;

  if v_household_id is null then
    raise exception 'not authorized to update child rewards';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;

  v_previous := v_balance.tickets;

  update public.child_balances cb
  set tickets = cb.tickets + p_amount
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  insert into public.reward_logs (
    household_id, child_id, type, title, message, amount, metadata
  ) values (
    v_household_id,
    p_child_id,
    'ticket',
    p_title,
    p_message,
    p_amount,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_balance', v_previous,
      'new_balance', v_balance.tickets
    )
  );

  return v_balance;
end;
$$;

create function public.add_star_coin(
  p_child_id uuid,
  p_amount integer,
  p_title text default null,
  p_message text default null,
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
  v_previous integer;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be non-zero';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;

  if v_household_id is null then
    raise exception 'not authorized to update child rewards';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;
  if v_balance.star_coins + p_amount < 0 then
    raise exception 'star coin balance cannot be negative';
  end if;

  v_previous := v_balance.star_coins;

  update public.child_balances cb
  set star_coins = cb.star_coins + p_amount
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  insert into public.reward_logs (
    household_id, child_id, type, title, message, amount, metadata
  ) values (
    v_household_id,
    p_child_id,
    'star_coin',
    p_title,
    p_message,
    p_amount,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_balance', v_previous,
      'new_balance', v_balance.star_coins
    )
  );

  return v_balance;
end;
$$;

create function public.exchange_star_coins_for_ticket(
  p_child_id uuid,
  p_title text default null,
  p_message text default null,
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
  v_previous_tickets integer;
  v_previous_star_coins integer;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;

  if v_household_id is null then
    raise exception 'not authorized to update child rewards';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;
  if v_balance.star_coins < 5 then
    raise exception 'at least 5 star coins are required';
  end if;

  v_previous_tickets := v_balance.tickets;
  v_previous_star_coins := v_balance.star_coins;

  update public.child_balances cb
  set star_coins = cb.star_coins - 5,
      tickets = cb.tickets + 1
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  insert into public.reward_logs (
    household_id, child_id, type, title, message, amount, metadata
  ) values (
    v_household_id,
    p_child_id,
    'star_exchange',
    p_title,
    p_message,
    1,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'star_coins_used', 5,
      'ticket_amount', 1,
      'previous_star_coins', v_previous_star_coins,
      'new_star_coins', v_balance.star_coins,
      'previous_tickets', v_previous_tickets,
      'new_tickets', v_balance.tickets
    )
  );

  return v_balance;
end;
$$;

create function public.adjust_pay_balance(
  p_child_id uuid,
  p_pay_type text,
  p_amount integer,
  p_title text default null,
  p_message text default null,
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
  v_previous integer;
  v_new integer;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be non-zero';
  end if;
  if p_pay_type is null or p_pay_type not in ('sweets', 'toy', 'game') then
    raise exception 'invalid pay type';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;

  if v_household_id is null then
    raise exception 'not authorized to update child rewards';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;

  v_previous := case p_pay_type
    when 'sweets' then v_balance.sweets_pay
    when 'toy' then v_balance.toy_pay
    when 'game' then v_balance.game_pay
  end;

  update public.child_balances cb
  set sweets_pay = case when p_pay_type = 'sweets' then cb.sweets_pay + p_amount else cb.sweets_pay end,
      toy_pay = case when p_pay_type = 'toy' then cb.toy_pay + p_amount else cb.toy_pay end,
      game_pay = case when p_pay_type = 'game' then cb.game_pay + p_amount else cb.game_pay end
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  v_new := case p_pay_type
    when 'sweets' then v_balance.sweets_pay
    when 'toy' then v_balance.toy_pay
    when 'game' then v_balance.game_pay
  end;

  insert into public.reward_logs (
    household_id, child_id, type, title, message, amount, metadata
  ) values (
    v_household_id,
    p_child_id,
    p_pay_type || '_pay',
    p_title,
    p_message,
    p_amount,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'pay_type', p_pay_type,
      'previous_balance', v_previous,
      'new_balance', v_new
    )
  );

  return v_balance;
end;
$$;

create function public.adjust_happy_chance(
  p_child_id uuid,
  p_amount integer,
  p_title text default null,
  p_message text default null,
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
  v_previous integer;
begin
  if p_child_id is null then
    raise exception 'child id is required';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'amount must be non-zero';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  select c.household_id
    into v_household_id
  from public.children c
  join public.household_members hm
    on hm.household_id = c.household_id
   and hm.user_id = auth.uid()
   and hm.role in ('owner', 'parent')
  where c.id = p_child_id
  for share of c, hm;

  if v_household_id is null then
    raise exception 'not authorized to update child rewards';
  end if;

  select cb.*
    into v_balance
  from public.child_balances cb
  where cb.child_id = p_child_id
  for update;

  if not found then
    raise exception 'child balance is unavailable';
  end if;
  if v_balance.happy_chance_cards + p_amount < 0 then
    raise exception 'happy chance balance cannot be negative';
  end if;

  v_previous := v_balance.happy_chance_cards;

  update public.child_balances cb
  set happy_chance_cards = cb.happy_chance_cards + p_amount
  where cb.child_id = p_child_id
  returning cb.* into v_balance;

  insert into public.reward_logs (
    household_id, child_id, type, title, message, amount, metadata
  ) values (
    v_household_id,
    p_child_id,
    'happy_chance',
    p_title,
    p_message,
    p_amount,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'previous_balance', v_previous,
      'new_balance', v_balance.happy_chance_cards
    )
  );

  return v_balance;
end;
$$;

revoke all on function public.add_ticket(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.add_star_coin(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.exchange_star_coins_for_ticket(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.adjust_pay_balance(uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.adjust_happy_chance(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.add_ticket(uuid, integer, text, text, jsonb)
  to authenticated;
grant execute on function public.add_star_coin(uuid, integer, text, text, jsonb)
  to authenticated;
grant execute on function public.exchange_star_coins_for_ticket(uuid, text, text, jsonb)
  to authenticated;
grant execute on function public.adjust_pay_balance(uuid, text, integer, text, text, jsonb)
  to authenticated;
grant execute on function public.adjust_happy_chance(uuid, integer, text, text, jsonb)
  to authenticated;

commit;
