# Current dashboard requirements

## 監査範囲と判断基準

- 調査対象は現行の `/parent` 実行経路、`parent/parent.js`、`src/services/api`、有効な4 migration、子ども側 `index.html` の localStorage data shape とした。
- staging の実スキーマは、今回確認済みとして提示された `profiles`、`households`、`household_members`、`children` の4テーブルを正とする。remote への接続や SQL 実行は行っていない。
- `supabase/archive/20260919_initial_hapichike_schema.sql.archived` は過去設計の参考に限り、現行スキーマや再利用可能な migration とは扱わない。
- `/parent` は Auth と SELECT だけを使用する。残高更新 RPC、localStorage、子ども側アプリとの同期は呼ばない。

## 現在の `/parent` 実行経路

| 呼び出し | table / relation / RPC | 実際に必要な列 | 用途 |
|---|---|---|---|
| `getParentSession` / `signInParent` / `signOutParent` | Supabase Auth | `auth.users.id`, `email` 相当 | ログイン状態と表示用メール。`profiles` は直接取得しない |
| `getCurrentHouseholds(user.id)` | `household_members` → `households!inner(*)` | `household_members.user_id`, `role`, `created_at`, `household_id` と、`households.id`, `name`, `created_at` | ログイン親が所属する家庭の一覧。FK relation が必要 |
| `getChildrenByHousehold(householdId)` | `children` | `id`, `household_id`, `name`, `display_order`; `icon` は任意表示 | 家庭内の子ども一覧。`household_id` で絞り、`display_order` で並べる |
| `getChildBalances(childId)` | `child_balances` | `child_id`, `tickets`, `star_coins`, `sweets_pay`, `toy_pay`, `game_pay`, `happy_chance_cards`, `updated_at` | 選択中の子どもの現在残高 |
| `getRecentRewardLogs(childId, 20)` | `reward_logs` | `child_id`, `created_at`, `type`, `title`, `message`, `amount`, `metadata` | 直近20件を取得し、全履歴10件とお手伝い履歴10件を表示 |

`children`、`child_balances`、`reward_logs` は現在 `select("*")` されるが、上表は描画・絞り込み・並び替えで実際に参照する列に限定した。`reward_logs.metadata` では `pay_type` と `reward_type` を読む。

履歴の現行表示が認識する `type` は次のとおり。

- `ticket_added`
- `star_coin_added`
- `pay_adjusted`
- `today_task_reward`
- `task_completed`
- `star_coin_exchange`
- `parent_gift`
- `help_job_reward`
- `help_board_reward`

`today_task_reward`、`task_completed`、`help_job_reward`、`help_board_reward` はお手伝い履歴として抽出される。未知の `type` も表示自体は可能だが、専用ラベル・単位表示はない。

## 現在の隣接 API と RPC

`/parent` が呼ばないものも、同じ API 層の契約として以下を確認した。

- `historyApi.getHouseholdRewardLogs` は `reward_logs.household_id` を使用する。
- `childrenApi.createChild` / `updateChild` は存在するが、`/parent` からは呼ばない。
- `rewardsApi` には `add_ticket`、`add_star_coin`、`exchange_star_coins_for_ticket`、`adjust_pay_balance` の wrapper があるが、対応する有効 migration はなく、`/parent` からも呼ばない。
- 現在の5つの家庭管理 RPC は `create_household`、`add_household_member`、`set_household_member_role`、`remove_household_member`、`transfer_household_ownership`。いずれも残高・履歴の更新には再利用できない。
- `is_household_member` と `has_household_role` は公開データ更新 RPC ではなく RLS 用 helper であり、追加テーブルの policy には再利用できる。

# Current staging schema

今回提示された staging 状態と有効 migration から、監査対象の現行構造を次のように扱う。

| table | 現在の列 | dashboardとの関係 |
|---|---|---|
| `profiles` | `id`, `created_at`, `display_name` | `/parent` は直接参照しない。Auth user と household membership の基礎 |
| `households` | `id`, `name`, `created_at` | 現在の dashboard 要件を満たす |
| `household_members` | `household_id`, `user_id`, `role`, `created_at` | 現在の dashboard 要件を満たす。role は `owner` / `parent` / `viewer` |
| `children` | `id`, `created_at`, `household_id`, `name`, `nickname` | `display_order` が欠けるため現行一覧 query が失敗する。`icon` は欠けても JS 上は省略表示になる |

存在しないものは `child_balances`、`reward_logs` と、ハピチケ固有の残高更新 RPC である。

# Gap table

| 必要項目 | 現在存在するか | 使用箇所 | 必須 / 任意 | 代替可能か | 追加推奨か |
|---|---|---|---|---|---|
| `households.id/name/created_at` | あり | 家庭 selector | 必須 | いいえ | 不要 |
| `household_members.household_id/user_id/role/created_at` と `households` relation | あり | ログイン user の家庭取得 | 必須 | いいえ | 不要 |
| `children.id/household_id/name` | あり | 子ども selector | 必須 | いいえ | 不要 |
| `children.display_order` | なし | `childrenApi` の `.order("display_order")` | 現行コードでは必須 | コードを `created_at` 等の既存列順に変えれば代替可能 | **追加推奨** |
| `children.icon` | なし | 子どもタブの任意 emoji | 任意 | icon なし表示、またはUI側固定 iconで代替可能 | **今回追加しない** |
| `child_balances` table | なし | 残高カード | 必須 | 複数列を `children` に持たせる案は責務が混ざるため非推奨 | **追加推奨** |
| `child_balances.child_id` | なし | 子ども別 `.maybeSingle()` | 必須 | いいえ | **追加推奨** |
| 6残高列 | なし | 6枚の残高カード | 必須 | JSON 1列は型・制約・更新安全性が落ちるため非推奨 | **追加推奨** |
| `child_balances.updated_at` | なし | 最終更新表示 | 必須相当 | 表示だけ消すコード変更で代替可能 | **追加推奨** |
| `child_balances.created_at` | なし | UI未使用 | 運用上推奨 | 省略可能 | **追加推奨** |
| `reward_logs` table | なし | 最近の履歴、お手伝い履歴 | 必須 | localStorage は `/parent` のデータソースにしないため代替不可 | **追加推奨** |
| `reward_logs.child_id/created_at/type/title/message/amount/metadata` | なし | 履歴 query と描画 | 必須。`title/message` は値として nullable 可 | UI変更で一部削減可能だが現行互換を失う | **追加推奨** |
| `reward_logs.household_id` | なし | 現行 dashboard では未使用、`getHouseholdRewardLogs` では使用 | dashboard単体では任意、API層全体と家庭単位監査では推奨 | `children` join で導出可能 | **追加推奨** |
| 残高更新 RPC | なし | `/parent` では未使用 | 今回の読取完成には不要 | 将来のserver処理で代替可能 | 今回は追加しない |

# children column decision

## `children.display_order`

**判断: 追加する。** 現行 `childrenApi` が database order を直接要求するため、列がないと icon のような表示劣化ではなく query error になり、子ども一覧と後続の残高・履歴取得まで止まる。家庭内の並び順は子どもの属性というより家庭内設定だが、複数子どもを安定した順序で表示する将来用途もあり、画面を通すだけの使い捨て列ではない。

推奨定義:

- `integer not null default 0`
- `check (display_order >= 0)`
- unique 制約は付けない。既存行 backfill と同時追加時に同順位を許容し、並べ替え更新の衝突も避ける。
- `(household_id, display_order, created_at, id)` の複合 index を推奨する。既存の `children_household_id_idx` と重複度が高いため、実装時は query plan と migration の簡潔さを見て既存 index を置換するか併存させる。
- 同順位時の完全な表示安定性には、将来 API query に `created_at` と `id` の二次 order を加えるのが望ましい。ただし今回は application code を変更しない。
- 列追加時の default 0 により既存行との後方互換性を保つ。

## `children.icon`

**判断: 最小完成には追加しない。** `child.icon` が `undefined` でも名前だけを正常表示するため、DB列は必須ではない。子ども別 icon を永続化する要件が確定した時点で `text null`、default なしとして追加する。空文字と未設定の二重表現を避けるため、保存時は空文字を `null` に正規化するのが望ましい。

- nullable: 可
- default: なし / `null`
- unique: 不要
- index: 不要
- 後方互換性: 未追加でも現行UIは動く。将来追加時も nullable なら既存行を壊さない。

# child_balances proposal

`child_balances` を「現在残高の正本」とする。1 child につき1行で、UIと既存 API の名称に合わせる。

| column | 推奨型・制約 | 理由 |
|---|---|---|
| `child_id` | `uuid primary key references children(id) on delete cascade` | 1 child 1残高をDBで保証する |
| `tickets` | `integer not null default 0` | localStorage `coins` と現行UIの `balance.tickets` に対応 |
| `star_coins` | `integer not null default 0` | `starCoins` に対応 |
| `sweets_pay` | `integer not null default 0` | `points.snack` に対応 |
| `toy_pay` | `integer not null default 0` | `points.toy` に対応 |
| `game_pay` | `integer not null default 0` | `points.game` に対応 |
| `happy_chance_cards` | `integer not null default 0` | `happyChanceCards` と現行UI名に対応 |
| `created_at` | `timestamptz not null default now()` | 行生成・運用監査用 |
| `updated_at` | `timestamptz not null default now()` | dashboard の更新日時表示用。更新 trigger で自動更新 |

列名は候補の `ticket_count` 等へ置き換えず、現行コードが参照する `tickets`、`star_coins`、`happy_chance_cards` を採用する。別名にすると application code 変更が必要になる。現行stateの正規化は `coins` と3種PAYの負値を保持し得るため、read model段階では6残高の一部だけに異なる制約を課さず、非負CHECKは追加しない。

`household_id` は **持たせない**。`children.household_id` から一意に導出でき、残高は child と同寿命の1対1データである。重複保持すると child の家庭移動時に不整合が起きる。家庭単位集計で join が必要になるが、現在の query は child ID 取得であり、`children.id` PK と `children.household_id` index があるため、この段階では正規化を優先する。

既存 child には migration 内で0残高を backfill し、今後の child insert には初期残高を作る trigger を設ける。authenticated client に `child_balances` INSERT 権限を与えずに trigger を動かすため、trigger function は固定 `search_path`、限定 owner、適切な `SECURITY DEFINER` とする。これにより `/parent` の `.maybeSingle()` が恒常的に1行を返す。

# reward_logs proposal

`reward_logs` は残高変更の履歴・監査情報であり、現在残高を再計算する唯一の source にはしない。現在値の正本は `child_balances`、履歴は append-only の副記録とする。将来の更新 RPC は同一 transaction 内で「残高更新 + log insert」を完了させる。

| column | 推奨型・制約 | 現行利用 |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | UI未使用だが行識別に必須 |
| `household_id` | `uuid not null` | 家庭単位 RLS、既存 `getHouseholdRewardLogs`、将来の家庭監査 feed |
| `child_id` | `uuid not null` | 子ども別 query |
| `type` | `text not null` | ラベル、単位、お手伝い履歴分類 |
| `title` | `text null` | 任意の表示タイトル。null時は `type` labelへ fallback |
| `message` | `text null` | 理由・補足表示。候補の `reason` を別列で重複させない |
| `amount` | `integer null` | 増減量。PAY減算は負数を許容。値なし event の fallback も現行UIが扱える |
| `metadata` | `jsonb not null default '{}'::jsonb` | `pay_type`、`reward_type` 等、type固有の少量データ |
| `created_at` | `timestamptz not null default now()` | 降順取得と日付表示 |

`type` は text のままとし、初回 migration では enum や既知値だけの CHECK を付けない。現行UIだけでも互換 alias が複数あり、将来の Happy Chance や同期 source を加える際に DDL 変更を強制しないためである。`metadata` を無制限な代替schemaにはせず、共通表示列は通常列に置く。

`household_id` は child から導出可能だが、次の理由で log には保持する。

- 既存 API が家庭単位履歴を query する。
- immutable event の発生家庭を固定できる。
- RLS と家庭単位の時系列 index を単純にできる。

一方で不整合を許してはならない。`(child_id, household_id)` が `children(id, household_id)` と一致する複合 FK、または同等のDB制約を設ける。RPC は caller から household ID を信用せず、child 行から導出して insert する。index は `(child_id, created_at desc)` と `(household_id, created_at desc)` を推奨する。

`actor_user_id` / `source` は現行 read UIが使わず、今回は書込み自体が対象外なので最小schemaには含めない。親編集や端末同期を実装する migration で、監査要件と source vocabulary を確定して追加する。先に曖昧な nullable 列だけを置かない。

# RLS strategy

- `child_balances` と `reward_logs` は RLS を必ず有効化し、`anon` には table privilege と policy を与えない。
- `authenticated` の SELECT は自家庭だけに限定する。
  - `child_balances`: `children` を介して `public.is_household_member(children.household_id)` を満たす行だけ。
  - `reward_logs`: `public.is_household_member(reward_logs.household_id)` を満たす行だけ。加えて child-household 整合性をDB制約で保証する。
- `owner` と `parent` は自家庭の children、残高、履歴を閲覧可能にする。
- `viewer` は role 名と現行 dashboard の read-only 性に合わせ、自家庭の children、残高、履歴を閲覧可能にする。書込みは一切不可とする。viewer に残高を見せない要件なら、UI・household取得・RLSを一緒に再設計する必要があり、現在の名前と導線には合わない。
- 他家庭は client filter に依存せず、RLSで0行にする。
- `authenticated` に `child_balances` / `reward_logs` の直接 INSERT、UPDATE、DELETE を grant しない。SELECT のみ grant する。
- 将来の残高変更は `SECURITY DEFINER` RPC に限定し、RPC内部で `auth.uid()`、child の household、`has_household_role(..., ['owner','parent'])` を検証する。viewer は拒否する。
- `service_role` をブラウザや通常運用の前提にしない。子ども Auth は今回作らない。
- `reward_logs` は append-only とし、通常 user に UPDATE / DELETE を許可しない。

# RPC strategy

## 現在の5 RPC

| RPC | 現在の用途 | 残高処理への再利用 |
|---|---|---|
| `create_household` | 家庭と owner membership の作成 | 不可 |
| `add_household_member` | member追加 | 不可 |
| `set_household_member_role` | role変更 | 不可 |
| `remove_household_member` | member削除 | 不可 |
| `transfer_household_ownership` | owner移管 | 不可 |

これらは household lifecycle 用であり、ハピチケ固有RPCと混同しない。RLS helper の `is_household_member` / `has_household_role` は新policyと新RPCの認可判定に再利用する。

## 今回と将来の判断

親 dashboard を「読む」ところまでなら新規 RPC は不要であり、今回の最小 migration には追加しない。

将来、親からの更新または子どもアプリ同期を実装する時は次を追加する。

| 候補 | 判断 | 要件 |
|---|---|---|
| `add_ticket` | 作る | 現行 `rewardsApi` と互換。正数付与、role検証、残高行 lock、log を同一transactionで記録 |
| `add_star_coin` | 作る | 同上。現行 wrapper と互換 |
| `exchange_star_coins_for_ticket` | 作る | `FOR UPDATE` で5枚以上を再確認し、5減算・ticket 1加算・logを原子的に実行 |
| `adjust_pay_balance` | 作る | `sweets` / `toy` / `game` を allowlist、変更後非負、log metadata に `pay_type` |
| Happy Chance増減 | 将来作る | 現行 wrapper がないため命名と利用主体を同期設計時に確定。仮に `adjust_happy_chance_balance` とし、変更後非負・log記録を必須にする |

全 mutation RPC は caller が渡す household ID や actor を信用せず、child から household を特定する。`public` / `anon` の EXECUTE を revoke し、`authenticated` に限定する。owner / parent の更新と、将来の child device 同期は同じ権限モデルとは限らないため、child Auth がない今は後者を先回りして許可しない。

# localStorage mapping

今回は移行・同期を行わない。将来設計用の対応は次のとおり。

| localStorage `kidsVegasCasino.v1` | Supabase | 注意 |
|---|---|---|
| `childName` | `children.name` | 現在は単一表示名で child ID がない。自動対応付け禁止 |
| `coins` | `child_balances.tickets` | local 名が ticket ではなく `coins` |
| `starCoins` | `child_balances.star_coins` | 0以上の整数として移行 |
| `points.snack` | `child_balances.sweets_pay` | `snack` と `sweets` の名称差に注意 |
| `points.toy` | `child_balances.toy_pay` | 1:1 |
| `points.game` | `child_balances.game_pay` | 1:1 |
| `happyChanceCards` | `child_balances.happy_chance_cards` | 予約中の `happyChanceReserved` はメモリのみで移行対象外 |
| `history` | `reward_logs` の候補 | text解析で安易に変換せず、type別 converter が必要 |
| `ticketGiftLogs` | `reward_logs` の `parent_gift` / `ticket_added` 候補 | `history` の同一操作と重複するため dedupe 必須 |
| `payLogs` | `reward_logs` の `pay_adjusted` 候補 | 使用は負の `amount`、`metadata.pay_type` を設定 |
| `transferHistory` | PAY振替 event候補 | 1 eventか出入2 eventかを同期仕様で確定し、残高合計不変を原子的に扱う |
| お手伝い完了の `history` | `today_task_reward` / `task_completed` 候補 | `metadata.reward_type` が `ticket` / `starCoin` |
| `starGiftHistory` | 直接は移行しない | 報酬eventではなくメッセージ入力候補 |
| `taskHistory` | `reward_logs` ではない | 検索・集計用の別データ。今回対象外 |

`history` と専用 log 配列には同じ操作が重複保存されるため、配列を単純連結すると二重履歴になる。将来の移行には child ID の明示選択、移行前 backup、idempotency key、重複判定、件数・残高照合が必要である。新規同期開始後は文字列履歴の解釈ではなく、操作時に型付き event を作る。

# Migration plan

変更量は read model とそのRLSが密接で、policyだけを別 migration にすると適用途中に access 不整合を作る。このため **最小 read schema は1 migrationにまとめ、mutation RPCは別タスク・別 migrationへ分離**する。

1. `202610080004_parent_dashboard_read_model.sql`
   - `children.display_order` 追加、既存行 default backfill、制約、並び順 index
   - `child_balances` 作成、既存 children の0残高 backfill、初期残高 trigger、`updated_at` trigger
   - `reward_logs` 作成、child-household整合制約、時系列 index
   - 両tableのRLS、SELECT-only grant、anon/直接mutation拒否
   - migration 内 preflight と、適用後に4既存tableを壊していないことの検証
2. `202610080005_parent_dashboard_reward_rpcs.sql`（親編集または同期を承認した将来タスク）
   - `add_ticket`、`add_star_coin`、`exchange_star_coins_for_ticket`、`adjust_pay_balance`
   - Happy Chance RPCは利用主体・命名確定後に含める
   - RPCごとの権限 revoke/grant、role検証、並行更新 lock、log同時記録

`children.icon` は要件確定までどちらにも含めない。schema / RLS を別 migration に細分化する必要はない。既存4 migrationと archive は変更しない。

# Minimum completion scope

「ログインして、自分の子どもの残高と最近の履歴を読む」ための最小完成ラインは以下。

1. 既存 Auth user、profile、household、membership、child の関係がある。
2. `children.display_order` があり、現行 child query が成功する。
3. childごとに1行の `child_balances` があり、6残高と `updated_at` を取得できる。
4. `reward_logs` があり、child別に `created_at desc limit 20` を取得できる。
5. authenticated household member（owner / parent / viewer）は自家庭のみ SELECT でき、anon と他家庭は取得できない。
6. authenticated user は残高・履歴を直接変更できない。
7. `/parent` の現行コードを変更せず、家庭切替、子ども切替、残高、最近の履歴が表示できる。

この完成ラインには自動同期、localStorage移行、親からの残高編集、Help Jobs、Tasks、Today Tasks、複雑な管理画面、子ども Auth、Happy Chance更新RPCを含めない。

# Risks

- `docs/CURRENT_STATE.md` など一部文書には remote 未適用の古い記述がある。本監査では今回提示された staging 4 table 構築済み状態を優先した。実装前には read-only schema introspection で列、制約、policy、grant、function signature を再確認する。
- APIが広く `select("*")` を使うため、DB列追加が暗黙にclient payloadへ現れる。将来は必要列の明示選択が望ましい。
- `display_order` が全行0の場合、現行 query には二次 order がなく同順位の厳密な順序は保証されない。ただし query error は解消される。
- balance作成 trigger を入れず任意行にすると、child作成とbalance作成の間で空表示が起きる。backfill + triggerで1対1 invariantを作るべきである。
- `child_balances` を正本、`reward_logs` を履歴とするため、将来の書込みで片方だけ更新すると不整合になる。更新をRPC transactionへ限定する必要がある。
- reward log の `household_id` は意図的な重複であり、childとの整合制約なしでは他家庭漏えいまたは誤分類の原因になる。
- child削除時に監査履歴を保持するかは未決定。`reward_logs` を保持するなら child の物理削除を制限し、将来 soft delete を検討する。
- localStorageは単一child・IDなし・履歴重複ありのため、自動対応付けや即時移行は安全でない。
- 現在の履歴 `type` vocabulary には互換 alias がある。初回schemaで厳しい enum を導入すると既存UIや将来同期を阻害する。

# Recommendation

最小かつ現在コード互換の推奨は次のとおり。

- `children` には `display_order` だけを追加し、`icon` は追加しない。
- `child_balances` は household ID を重複保持せず、child 1対1の現在残高の正本とする。
- `reward_logs` は child と household を持つ append-only 履歴とし、残高の唯一の source にはしない。
- owner / parent / viewer に自家庭の SELECT を許可し、direct mutation は全roleで禁止する。
- 読取完成に不要な残高 RPC は今回作らず、親編集または同期を始める時に別 migration で原子的な RPC を追加する。
- read schema + RLSを1 migration、将来の mutation RPCを別 migrationに分ける。

この方針なら、最小 read schema の migration実装へ進める状態にある。実装開始時の確定事項は「viewerは読取可」「iconは延期」「child_balancesにhousehold_idを持たせない」「reward_logsには整合制約付きでhousehold_idを持たせる」の4点である。

## 004 read model 実装（2026-10-08）

`202610080004_parent_dashboard_read_model.sql` は `/parent` のSELECT契約だけを満たすread modelとして、`children.display_order`、`child_balances`、`reward_logs`、家庭単位SELECT RLS、最小GRANTを追加する。残高更新RPC、localStorage同期、データ移行、UI変更は含めない。既存stateとの互換性を優先し、6残高列には非負CHECKを追加しない。
