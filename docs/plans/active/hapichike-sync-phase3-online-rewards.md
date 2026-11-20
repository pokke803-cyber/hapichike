# HAPICHIKE sync Phase 3A: online rewards

## Source of truth

`child_app_sync_state.app_id = hapichike` かつ `initial_import_completed_at` があるChildは、`child_balances`を6残高のSource of Truthとする。`kidsVegasCasino.v1`はUI cache、offline準備、legacy compatibilityとしてschemaを維持する。通常操作からsnapshot全体をCloudへ送らない。

## Cloud-ready child

保存済みmappingがあり、Supabase sessionが有効で、mappingのhouseholdがログイン親の所属先に含まれ、対象ChildがそのhouseholdのSELECT結果に含まれ、hapichike initial import完了を取得できた場合だけCloud RPCを使う。mappingなし／import未完了は既存local-only。mapping済みでsession、network、household、Childの検証に失敗した場合は残高分岐を防ぐため操作を確定しない。

## Reward event flow

操作ごとに `type / child_id / amount / category / source / created_at` を持つ一時eventを作り、永続queueには保存しない。操作 → 005 RPC → RPC transaction → `child_balances`再取得 → local cache更新の順。フロントから`reward_logs`へINSERTしない。

## Existing 005 RPC mapping

- Ticket増減: `add_ticket`
- Star Coin増減: `add_star_coin`
- Star Coin 5枚→Ticket 1枚: `exchange_star_coins_for_ticket`
- Sweets/Toy/Game PAY増減: `adjust_pay_balance`（categoryは`sweets / toy / game`）
- Happy Chance増減: `adjust_happy_chance`

PAY振替と、BET・カード・結果を含むルーレットは005に複合RPCがないため、意味単位の既存RPCを順次実行する。各RPC成功後に必ず最新server balanceをcacheへ反映する。途中失敗時に既にcommitされたRPCは巻き戻せないため、表示cacheはその時点のCloud値を維持する。

## Local delta update

RPC成功後に同一eventの差分だけを開始時のLocal v2 profileへ適用する。Cloudの全残高でLocalを置換せず、Phase 3開始前からあるLocal/Cloud差分はreconciliation工程まで維持する。

## Error handling

RPC、再取得、session、network、RLSの失敗時は該当操作のlocal加減算・成功履歴を確定せず、短いエラーを表示してlockを解除する。offline queueと自動retryは作らない。

## Double-submit protection

同じreward action keyをRPC開始からcache更新完了までlockする。重複操作はRPCを送らず、完了または失敗後に再操作可能にする。ルーレットの既存`spinning` lockも維持する。

## Staging test

主対象はParent A / Child C。開始値はtickets 3、star 1、3種PAY 0、Happy Chance 0。local test完了後に各+1、starを5まで増加、atomic exchange、star不足、Happy Chance負数、sessionなし、invalid mapping、Parent B越境、二重クリックを確認する。各成功でbalance、local cache、reward_logs増分を照合する。productionは操作しない。

## Phase 3A event_id

007 migrationの既存005 RPC overloadへUUID v4 `event_id`を渡し、`reward_mutation_events.event_id`のPRIMARY KEYで二重更新を防止する。同じ操作の通信retryは保存済みeventIdを再利用する。

## Future Phase 4 offline queue

offline queue、retry queue、background sync、競合解決はPhase 4で設計する。
