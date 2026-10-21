# Parent Dashboard Reward RPCs

## RPC list

- `add_ticket`
- `add_star_coin`
- `exchange_star_coins_for_ticket`
- `adjust_pay_balance`
- `adjust_happy_chance`

All RPCs return the updated `child_balances` row. `src/services/api/rewardsApi.js` exposes matching wrappers; no current UI calls them.

## Permissions

Only authenticated household members with role `owner` or `parent` may update a child's rewards. `viewer`, `anon`, unaffiliated users, and members of another household are rejected. The child determines the household; callers never provide a household ID.

`authenticated` retains SELECT-only table grants. Balance updates and reward-log inserts occur only inside `SECURITY DEFINER` RPCs. Every function uses an empty `search_path`, fully qualified application objects, revoked PUBLIC/anon execution, and explicit authenticated execution.

## Transaction model

Each function locks the child and matching membership while authorizing, then locks the `child_balances` row with `SELECT ... FOR UPDATE`. The balance update and `reward_logs` insert are in one PostgreSQL statement transaction. Any error, including a log-insert failure, rolls back the balance update.

## Logging model

Each successful operation appends exactly one log with household ID derived from the child. Types are `ticket`, `star_coin`, `star_exchange`, `sweets_pay`, `toy_pay`, `game_pay`, and `happy_chance`. Caller metadata must be a JSON object; trusted balance details are merged after it so they cannot be overwritten.

`reward_logs` remains append-only to clients: authenticated users receive no direct INSERT, UPDATE, or DELETE grant.

## Star exchange

Exchange is manual, matching the current localStorage UI. One call consumes exactly five star coins and adds one ticket. The locked balance row is checked after lock acquisition, preventing the same five coins from being exchanged twice.

Star coins cannot become negative because the current local state normalizes negative values to zero. No automatic exchange is performed by `add_star_coin`.

## PAY rules

`adjust_pay_balance` accepts only `sweets`, `toy`, or `game` and uses fixed CASE expressions rather than dynamic SQL. Negative PAY balances remain allowed for compatibility with existing stored values.

Tickets also remain allowed to become negative. Happy Chance cards, like star coins, cannot be reduced below zero because the current local state normalizes them to non-negative values.

## Failure behavior

Null child IDs, zero/null amounts, invalid PAY types, non-object metadata, missing balances, insufficient stars, negative star/card results, and unauthorized access fail without a partial balance or log change. Authorization errors use the same message for missing, cross-household, and insufficient-role children.

## Test matrix

`supabase/tests/local_parent_dashboard_reward_rpcs.sql` covers owner/parent success; viewer, anon, and cross-household rejection; input validation; ticket/star/PAY/card changes; manual exchange and repeat rejection; log identity/content; direct-write rejection; and forced log failure rollback. It also checks that exchange contains a balance-row lock.

The existing `local_rpc_rls.sql`, `local_event_trigger.sql`, and `local_parent_dashboard_read_model.sql` remain regression tests.

## Future child-app integration

The localStorage child app remains unchanged. A future integration must first define child-to-`children.id` mapping, migration/restore behavior, and conflict handling; it should then call these wrappers instead of writing balance tables directly.
