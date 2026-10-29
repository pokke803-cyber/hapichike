# HAPICHIKE localStorage ↔ Supabase 段階同期 設計監査

監査日: 2026-10-22

## 監査範囲と前提

- 現行挙動の根拠はアプリ本体 `index.html` とした。`homecasino.html.txt` のlocalStorage実装は同一だが、末尾の `/src/api-bootstrap.js` 読込だけがなく、ファイル全体は完全一致ではない。この差は今回のlocalStorage inventoryを変えない。
- Supabase 側は、リポジトリの migration `001`〜`005` と API wrapper を確認した。remote / staging の実状態は読み書きしていない。Auth、`households`、`household_members`、`children`、`child_balances`、`reward_logs`、Parent A/B RLS 試験、005 Reward RPC staging PASS は依頼時点の確認済み事実として扱う。
- 今回は設計監査のみである。localStorage、Supabase、staging、production、UI、アプリコード、migration、Git履歴は変更していない。本書だけを追加した。
- 両HTMLの localStorage 実装は同一だった。物理的な localStorage key は2個だけで、主キーの中に複数フィールドが入る。

# Current localStorage inventory

## 物理キー

| localStorage key | 値の型 / 形 | child別か | 現在UIでの用途 | Supabase移行対象 | 今回の同期対象 | 将来対象 |
|---|---|---|---|---|---|---|
| `kidsVegasCasino.v1` | JSON文字列化された単一 `state` object | **共有**。単一child相当だがchild IDも複数child分離もない | 子ども名、全残高、タスク、履歴、簡易親設定、音設定を一括保存 | フィールドごとに判断 | 残高6種のみ | task、履歴、設定等は個別判断 |
| `kidsVegasCasino.parentEmail.v1` | string | 共有 | 親メール。主state内の `parentEmail` より優先 | 原則しない | しない | Auth userとの対応を設計した後に任意移行 |

独立した `tickets`、`starCoins`、`SweetsPAY` 等の localStorage key は存在しない。すべて `kidsVegasCasino.v1` の内部フィールドである。`sessionStorage`、IndexedDB、Cookieの利用もない。

## `kidsVegasCasino.v1` 内部フィールド

| フィールド | 値の型 / 形 | child別か | 現在UIでの用途 | Supabase移行対象 | 今回同期 | 将来 |
|---|---|---|---|---|---|---|
| `childName` | string、最大12文字 | 単一共有stateの表示名 | 子ども名表示・変更、メール本文 | mapping時の表示補助のみ | 値そのものの自動同期はしない | 明示確認後 `children.name` または `nickname` を更新可能 |
| `coins` | number、単一値 | 共有 | チケット残高、タスク報酬、BET、親付与、スター交換 | 対象 | 対象 | 継続同期 |
| `starCoins` | number、単一値、読込時は0以上へ正規化 | 共有 | タスク報酬、ありがとうスター、5枚→チケット交換 | 対象 | 対象 | 継続同期 |
| `happyChanceCards` | number、単一値、読込時は0以上へ正規化 | 共有 | ルーレットで獲得、次回ルーレット+1P予約時に消費 | 対象 | 対象 | 継続同期 |
| `points.snack` | number | 共有 | SweetsPAY残高 | 対象 | 対象 | 継続同期 |
| `points.toy` | number | 共有 | ToyPAY残高 | 対象 | 対象 | 継続同期 |
| `points.game` | number | 共有 | GamePAY残高 | 対象 | 対象 | 継続同期 |
| `tasks` | `Task[]` | 共有 | お手伝い候補、親による追加・編集・削除 | 現行DBに対応先なし | しない | HAPICHIKE固有テーブル設計後 |
| `todayTasks` | `TodayTask[]` | 共有 | 今日のやること、完了状態、報酬snapshot、`ticketGranted` | 現行DBに対応先なし | しない | HAPICHIKE固有テーブル設計後 |
| `history` | `HistoryEntry[]`、最大40 | 共有 | 全履歴および完了履歴。複数操作の説明ログ | 一部は概念上 `reward_logs` | 過去明細は移さない | cloud移行後の新規イベントだけ記録 |
| `payLogs` | `PayLog[]`、最大50 | 共有 | PAY使用履歴 | 概念上 `reward_logs` と重複 | 過去明細は移さない | cloud移行後の新規PAY操作 |
| `transferHistory` | `TransferLog[]`、最大50 | 共有 | PAY間1:1振替履歴 | 現行RPCは原子的振替に未対応 | 過去明細は移さない | 複合RPC追加後 |
| `ticketGiftLogs` | `TicketGiftLog[]`、最大50 | 共有 | 親からのチケット付与履歴 | `reward_logs` と対応可能 | 過去明細は移さない | cloud移行後の新規付与 |
| `taskHistory` | `TaskHistoryEntry[]`、最大80 | 共有 | title+category単位の検索候補、完了回数 | `reward_logs` ではない | しない | HAPICHIKE固有の履歴/集計として検討 |
| `starGiftHistory` | string[]、最大20、完全一致重複排除 | 共有 | ありがとうスターのメッセージ候補 | 残高履歴ではなく入力候補 | しない | 原則local。必要ならHAPICHIKE設定 |
| `parentPassword` | string、初期値 `1234`、平文 | 共有 | 同一端末の簡易親ロック | **移行禁止** | しない | Supabase Authとは統合せず廃止計画を別途検討 |
| `parentEmail` | string | 共有 | 旧互換値。専用keyが優先 | 原則しない | しない | 専用keyと同じ扱い |
| `badges` | string[] | 共有 | 表示バッジ | 現行DBに対応先なし | しない | HAPICHIKE固有 |
| `audioSettings` | object `{bgmEnabled,sfxEnabled,bgmVolume,sfxVolume}` | 端末共有 | BGM/SFX ON/OFFと音量 | cloud不要 | しない | device-localのまま |
| `lastDailyResetKey` | string、午前6時境界の日付キー | 端末共有 | 今日タスクの自動リセット判定 | cloud残高に不要 | しない | today task同期時に再設計 |

### task / today task / completed task の実体

- task候補は `tasks[]`。各要素は `id`、`icon`、`title`、`difficulty`、`ticketReward`、`rewardType`、`starCoinReward`、`category`、`status`、`isDefault` を持つ。
- today taskは `todayTasks[]`。`taskId`、`status`、`startedAt`、`completedAt`、報酬snapshot、`ticketGranted` を持つ。
- completed task専用key/配列はない。`todayTasks` の完了status (`done` 等を正規化) が該当する。
- `ticketGranted` は同一のTodayTaskをUI上で再完了したときの二重付与を防ぐが、端末間、再送、再importに対するidempotencyではない。

### roulette関連で永続化されるもの

永続化されるのは `coins`、`points.*`、`happyChanceCards` と説明用 `history` だけである。`activeBet`、`activeCategory`、`rotation`、`spinning`、`latestRouletteResult`、`happyChanceReserved` はメモリのみで、localStorage keyではない。

### 履歴の重複構造

- タスク完了は `history` に入り、同じ配列から「お手伝いかんりょうきろく」と「ぜんぶのきろく」の両方に表示される。
- PAY使用は `payLogs` と `history` の両方に入る。
- PAY振替は `transferHistory` と `history` の両方に入る。
- 親チケット付与は `ticketGiftLogs` と `history` の両方に入る。
- `taskHistory` は監査ログではなく検索候補兼集計である。
- `starGiftHistory` はメッセージ候補で、報酬イベント履歴ではない。
- 多くの `history` entry に安定したUUID、ISO timestamp、厳密なamount、before/afterがなく、表示文字列中心である。配列ごとに保持上限も異なるため、完全な台帳としては使えない。

# Supabase mapping

| localデータ | 現行Supabase | 判定 / 注意 |
|---|---|---|
| `coins` | `child_balances.tickets` | 直接対応 |
| `starCoins` | `child_balances.star_coins` | 直接対応 |
| `points.snack` | `child_balances.sweets_pay` | 直接対応。local内部名とDB名が異なる |
| `points.toy` | `child_balances.toy_pay` | 直接対応 |
| `points.game` | `child_balances.game_pay` | 直接対応 |
| `happyChanceCards` | `child_balances.happy_chance_cards` | 直接対応 |
| `childName` | `children.name` / `children.nickname` | 自動一致キーではない。用途定義後に表示値としてのみ対応 |
| local child ID | 該当なし | localにはchild IDがない。`Task.id`を流用してはいけない |
| `history` の報酬イベント | `reward_logs` | 新規cloud操作のみ正規ログ化。過去配列の一括変換は非推奨 |
| `payLogs` | `reward_logs` | 新規操作はPAY使用イベントとして記録。過去は重複のため移さない |
| `transferHistory` | `reward_logs` | 1イベントとして記録すべきだが、005にPAY振替の原子的RPCはない |
| `ticketGiftLogs` | `reward_logs` | 新規操作は `add_ticket` 系で記録可能 |
| `tasks` | 対応テーブルなし | 今回対象外。`reward_logs`へ押し込まない |
| `todayTasks` / completed state | 対応テーブルなし | 今回対象外。残高イベントとの原子性は将来のタスク同期で再設計 |
| `taskHistory` | 対応テーブルなし | 今回対象外 |
| `starGiftHistory` | 対応テーブルなし | local入力候補のまま |
| `parentPassword` | 対応禁止 | Supabase Auth passwordでも `parent_settings` でもない |
| 親メール2箇所 | 現行の適切な対応なし | Auth emailと同一とは限らないため自動移行しない |
| `badges` | 対応テーブルなし | HAPICHIKE固有。可能なら将来再計算 |
| `audioSettings` | 対応不要 | device-local |
| `lastDailyResetKey` | 対応不要 | 現行ではdevice-local |

005の5 RPCは `add_ticket`、`add_star_coin`、`exchange_star_coins_for_ticket`、`adjust_pay_balance`、`adjust_happy_chance`。いずれも認証済み `owner` / `parent` が対象childの家庭に属することを確認し、残高行をlockして更新と `reward_logs` insertを同一transactionで行う。ただし現状は `event_id` を受け取らず、retry idempotencyはない。

# Source of truth

## 3案比較

| 案 | 利点 | 主な問題 | 判定 |
|---|---|---|---|
| A. localStorage正本、Supabase mirror | 現行コード変更が少なくofflineが自然 | 複数端末の競合、改ざん値、last-write-wins、二重送信を解決できない。親画面の値が遅延mirrorになる | 恒久案として不採用 |
| B. 即時Supabase正本、localStorage cache | 一貫性、RLS、行lock、複数端末対応が明確 | child mapping、backup、initial import、idempotency、offline queue、複合RPCが未完成の現在は既存資産を危険にさらす | 到達点だが即時切替は不可 |
| C. 段階移行。移行中はlocal資産を保護し、完了後Supabase正本 | 既存データを残しつつ比較・承認・rollbackでき、最終的な競合規則も明確 | 一時的に二つの状態を扱うためphaseと状態表示が必要 | **推奨** |

## 推奨正本

推奨はC。初回importが `completed` になるまでは、現行 `kidsVegasCasino.v1` を変更せず既存資産として扱う。ただしこの期間に双方向自動mergeはしない。read-only cloud比較、親によるchild mapping、backup検証、import previewを経て、一度だけ原子的snapshot importを行う。

import完了後は `child_balances` を残高の唯一の正本とする。localStorageには「最後にserverで確認済みのsnapshot」と「未送信event queue」を分けて保持し、localの合計値をserverへ丸ごと上書きしない。既存 `kidsVegasCasino.v1` はrollback用legacy snapshotとして保存し、明示的な廃止計画までは削除しない。

# Initial import

## 通常RPCと分離する

`add_ticket(+現在値)` 等による初回移行は不採用。通信timeout後のretry、戻る操作、別端末からの再実行により二重加算されるためである。初回importは絶対値snapshotを扱う専用RPCに分離する。

将来の006候補として、認証済みparent専用の `import_initial_child_balance` 相当を追加する。今回作成はしない。1 transaction内で次を行う。

1. `auth.uid()` が対象childの家庭の `owner` / `parent` であることを確認する。
2. 対象 `children`、`child_balances`、同期状態行をlockする。
3. `(app_id='hapichike', child_id)` の初回import完了有無を確認する。
4. `import_id` と canonical snapshot hash を検証する。
5. 未完了の場合だけ6残高を**絶対値で**設定する。通常のincrement RPCは使わない。
6. `reward_logs` に `initial_import` を1件追加し、6残高、hash、source、import versionをmetadataへ残す。
7. sync stateをcompletedにして、更新後残高を返す。

### import前のcloud残高

- `child_balances` が初期0で、cloud reward logもない場合だけ通常の初回importを許可する。
- 既にcloud残高またはcloud操作履歴がある場合は自動加算・自動上書きをしない。previewでlocal / cloudを並べ、既定は「cloudを維持」。別途parentが明示承認するreconciliation手続きに送る。
- localが0でも「import済み」と記録する。値が0であることと未importを混同しない。
- 現行コードは `coins` と3種PAYを読込時に非負へ丸めない。負値を発見しても勝手に0へ直さず、backupに原値を保持してparent確認へ送る。スターコインとカードは現行normalize後の値も含め、raw値との差をpreviewする。

## snapshotの内容

初回import対象は6残高だけとする。`coins`、`starCoins`、3種 `points`、`happyChanceCards` を整数としてcanonical順序でhash化する。child mapping、app ID、schema/import versionもhash対象に含める。表示用history文字列、親パスワード、メール、音設定は含めない。

## 必須の事前条件

- 原本の `kidsVegasCasino.v1` と親メールkeyを含むversion付きJSON backupを作成し、同じアプリでvalidationできること。
- 親がSupabase Authでrecent authentication済みであること。
- child mappingを親が画面上で確認していること。
- local / cloudの6残高、対象家庭、対象child、import ID、hashをpreview表示すること。
- 完了後にserver値を再取得して6残高一致を検証すること。

## Rollback / recovery

- import RPC内の途中失敗はtransaction全体をrollbackし、残高、import marker、import logの部分成功を残さない。
- cutover前は既存localStorageを正本としてそのまま使える。比較やpreviewだけではlocal値を変更しない。
- import成功後も既存keyとimport前JSON backupを削除しない。問題発生時はsync送信を停止し、local-only legacy modeへ一時的に戻せるようにする。
- import成功後のcloud残高を「逆delta」で自動取消ししない。すでに別端末の正規eventが続いている可能性があるため、import log、現在値、import前snapshotをparentが確認し、専用recovery/adjustment手続きで補正する。
- local cache破損時はSupabase正本から再構築する。cloud側の誤操作はappend-only auditを残した補正eventで回復し、`reward_logs` の削除や過去行編集は行わない。

# Child mapping

## 現状監査

- localにあるのは `childName` だけで、プロフィールIDではない。
- localのnicknameフィールドはない。
- `tasks[].id` / `todayTasks[].taskId` はtask識別子でありchild IDではない。
- 複数child配列、選択中child、child切替UIはない。名前を変更しても同じ共有データを使う。
- Supabase `children` は UUID `id`、`household_id`、`name`、nullable `nickname` を持つ。

## 推奨mapping手順

1. parentがAuthで家庭を選択する。
2. serverからその家庭のchildrenだけを取得する。
3. local `childName` は候補の初期表示にだけ使い、名前一致で自動確定しない。
4. parentが既存childを明示選択するか、新規childを作成する。
5. 「localのこの全データ → household / child」を残高preview付きで確認する。
6. 将来のlocal sync設定に `local_profile_id`（新規UUID）、`app_id`、`household_id`、`supabase_child_id`、`mapping_confirmed_at` を保存する。
7. server側にも `(app_id, child_id)` のsync stateを持ち、初回import済み判定をlocalだけに依存しない。

local mappingは起動時の利便性とqueue routingに必要だが、改ざん可能なので認可根拠にはしない。RPCは必ず `p_child_id` からhouseholdを逆引きし、呼出userのmembershipを検証する。server側の `child_id + app_id` が初回importの一回性を保証する。

# Idempotency

## 初回import

最小要件は次の組み合わせ。

- server側 unique `(child_id, app_id)`：そのchildへのHAPICHIKE初回importを1回に限定。
- globally unique `import_id`：同一要求のretry識別。
- `source_snapshot_hash`：同じIDで内容が変わった要求を拒否。
- `import_version`：将来の変換規則を識別。
- `imported_at`：監査用server timestamp。

`source_device_id` は監査には有用だが、一回性の根拠にはしない。端末を変えれば別IDになるためである。初回最小実装ではsync stateの任意metadataに入れ、必須列にしなくてもよい。

## 通常イベント

すべての残高変更操作にclient生成UUID `event_id` を1個発行し、成功するまで同じIDを再利用する。button再押下やretryで新しいIDを作ってはいけない。

006では005 RPCを互換維持しつつ拡張する。推奨は `p_event_id`、`p_app_id`、request fingerprintを受ける新signatureまたはversioned RPC。serverでは `(child_id, app_id, event_id)` をuniqueにする。同一event / 同一fingerprintのretryは二度更新せず既存結果を返し、同一event / 異なるpayloadは拒否する。

unique constraintだけでも二重加算はrollbackできるが、clientには「既に成功済み」を正常結果として返す必要があるため、RPC内の明示的なduplicate処理を推奨する。残高行lock下で既存eventを確認し、更新とlogを同一transactionに保つ。

# Normal sync

## 3案比較

| 案 | 評価 |
|---|---|
| A. local更新 → RPC → 成功時Supabase確定 | offline互換は高いが、失敗中のlocal表示が正本に見え、二重送信・競合・改ざん値uploadの危険が高い |
| B. RPC → 成功時local更新 | online時の一貫性が最も明確。失敗時に正本とUIがずれにくいが、offlineでは操作不能 |
| C. local confirmed cache + pending event queue → RPC → server応答でcache置換 | offlineを維持できる。設計量は増えるが、local合計値の上書きを避けられる |

## 推奨

- online時はB: RPC成功後、そのRPCが返す**更新済み `child_balances` 全行**でconfirmed cacheを置換する。localで計算した予想値を確定値にしない。
- offline対応導入後はC: confirmed server snapshotとpending eventsを分離する。子ども向けUIは必要なら「反映待ち」を加味したprojected balanceを表示するが、正本はserverのまま。
- reconnect、画面復帰、Auth復帰、別端末更新通知後にserverを再取得し、confirmed cacheを上書きする。pending eventは消さず、新snapshot上で再評価する。

## 005 RPCだけでは不足する操作

- スター5枚→チケット1枚は既存 `exchange_star_coins_for_ticket` で原子的。
- 単一ticket/star/PAY/card増減は該当RPCで扱える。ただしevent id追加前はretry安全でない。
- PAY振替は2つのPAY残高を同時に変えるため、専用 `transfer_pay_balance` 相当が必要。`adjust_pay_balance` を2回呼ぶ方式は部分成功する。
- ルーレットはチケットBET、場合によりチケット返却、PAY加算、ハピチャン消費/獲得を1操作で行う。複数005 RPCの連鎖は禁止し、結果と全deltaを検証して一括commitするHAPICHIKE専用RPCが必要。
- タスク完了と報酬付与をcloud化する場合、task completion IDとreward eventを同一transactionで一度だけ確定する専用処理が必要。現行 `ticketGranted` だけでは端末間重複を防げない。

# Offline strategy

## 比較

| 方針 | 利点 | 問題 |
|---|---|---|
| 1. offline時は変更不可 | 最も単純で不整合が少ない | 家庭内アプリとして使い勝手が悪く、回線障害でお手伝い記録も止まる |
| 2. eventをlocal queueへ保存し、online復帰後送信 | 操作を保持し、serverで順序・idempotency・制約を適用できる | pending表示、retry、拒否時処理、端末認証が必要 |
| 3. local残高を先に確定し後でreconcile | 現行体験に近い | localの改ざん済み合計や古い合計を正本へ押し付ける危険が最大 |

推奨は2。ただしUI上は即時の達成感を保つため、confirmed残高とは別にpending eventを加味した暫定表示を許す。「local総額を後からupload」する3ではなく、「意味を持つeventを後送」する。

### queue item最小形

- `event_id` UUID
- `app_id`
- mapped `child_id`
- `operation_type`
- 正規化済みpayload
- `created_at_local`
- `attempt_count` / `last_attempt_at`
- `status`: pending / sending / accepted / rejected / needs_parent
- request fingerprint

online復帰時は作成順に送る。同じchildの残高イベントは直列送信する。network timeoutは同じ `event_id` でretryする。server business ruleにより拒否されたもの（残高不足等）は自動改変せず `needs_parent` にし、最新server残高へrebaseする。

重要な前提として、現行子ども画面にはSupabase Authがない。parent sessionを子ども端末へ常駐させると005の全parent更新権限を渡すことになる。安全なdevice identity / 限定権限方式ができるまでは、offline queue送信を本番化せず、Phase 3はparent認証中のonline同期に限定する。

# Reward log migration

## 選択肢比較

| 案 | 評価 |
|---|---|
| 全履歴を移す | 見た目は豊富だが、重複配列、欠落、表示時刻、UUID不足、文字列解析により誤台帳になる。非推奨 |
| 残高だけ移し履歴なし | 単純だが、初回残高の由来がcloudで説明できない |
| 直近N件 | 件数境界に意味がなく、重複・不完全性も残る。非推奨 |
| legacy import log 1件 | 現在残高の出所とsnapshot hashを監査でき、過去履歴を正規イベントと誤認しない | **推奨** |

推奨は6残高snapshotをimportし、`reward_logs` に `initial_import` / `legacy_balance_import` 1件だけを作る。metadataに6残高、local schema識別子、snapshot hash、import version、原本backup IDを含める。過去の `history`、`payLogs`、`transferHistory`、`ticketGiftLogs` はlocal原本およびJSON backupに保持し、cloudの正規報酬台帳へは混ぜない。

将来、過去履歴閲覧が必要なら、reward ledgerとは分離したlegacy archiveとしてread-only importする。自動文字列解析でamountを生成しない。

# JSON backup interaction

## backup

- 初回import前の必須gateにする。
- envelopeに `format_version`、`app_id`、`exported_at`、local state原文、parent email key、local profile ID、checksumを持たせる。
- export時の原本を変更・正規化してから保存するのではなく、raw値とvalidation結果を保持する。
- passwordとparent emailを含める場合は平文機密データであることを明示し、可能ならparent設定を残高backupから分離する。

## restore

古いJSONを読んだだけでSupabaseへ書かない。次の二経路を分離する。

1. **local-only restore**: offline/legacy用。cloud mapping済みの場合は通常local stateを直接正本扱いせず、隔離previewまたは新しいlocal profileとして復元する。
2. **cloud restore申請**: parent再認証、child ID/家庭確認、backup version/checksum検証、現在cloudとの差分preview、理由入力、明示確認を必須にする。一般sync RPCではなく専用の監査可能なrecovery処理を使う。

cloud restoreは既存 `child_balances` の無条件上書きではなく、restore request IDによる一回性、restore前server snapshot、restore後snapshot、実行parent、backup ID、server timestampを記録する。通常UIからは「keep cloud」を既定にする。child ID不一致、別家庭、未知version、import時点より古いbackupは自動適用せず停止する。

# Conflict handling

- 残高の競合はserver-side RPCとrow lockで直列化する。
- local cacheにversionを持たせる場合は `child_balances.updated_at` だけで完全順序を作らず、将来 `balance_version bigint` の単調増加を推奨する。時刻は表示・診断用にする。
- RPC成功時はserverが返した全残高とversionでcacheを置換する。
- app起動、foreground復帰、online復帰、RPC失敗、Realtime通知、一定間隔のrefreshで再取得する。
- local値でSupabase全列を上書きしない。差分イベントだけをRPCへ送り、server結果を取り込む。
- stale cacheを基にした減算はserver側で残高条件を検証する。拒否時は最新残高を表示し、pending eventを `needs_parent` にする。
- 同時操作でも、同じ `event_id` は一度だけ、別eventはserver受理順に適用される。
- rouletteのように結果が複数残高へ影響する操作は単一transaction。client側で別RPCへ分解しない。

# Sync metadata

専用metadataは**必要**。ただし初回は最小にする。local markerだけではlocalStorage消去・コピー・改ざんで再importできるため、server側記録が必須である。

## 最小server sync state案

概念名: `child_app_sync_state`（Family Core共通候補）

| 列 | 必須性 | 用途 |
|---|---|---|
| `child_id` | 必須 | 対象child。FK |
| `app_id` | 必須 | `hapichike` 等。`child_id` と複合unique/PK |
| `initial_import_id` | 必須 | retry識別。unique |
| `initial_import_completed_at` | 必須 | 未実施/完了を区別するserver timestamp |
| `import_version` | 必須 | snapshot変換規則 |
| `source_snapshot_hash` | 必須 | 同じimport IDのpayload差し替え検出 |
| `last_synced_at` | 任意 | 表示用。正本判定や競合制御には使わない |

`initial_import_completed boolean` はtimestampのnull/non-nullで表せるため不要。`source` は初回は固定 `hapichike_localstorage` なので列ではなくlog metadataでもよい。`source_device_id` は監査補助であって一回性には使えないため、初回最小列から外せる。

通常event idempotencyはsync state 1行に詰めず、`reward_logs.event_id` 等のevent ledgerで保証する。queue状態は端末localに持ち、serverにはaccepted eventだけを残す。

# Security risks

| リスク | 対策 |
|---|---|
| service_role漏えい | frontendはanon key + user sessionだけ。service_roleは配置・bundle・ログ出力しない |
| 別家庭childへの誤送信 | clientのhousehold IDを信用せず、RPCがchildからhouseholdを導出しmembership/roleを確認。現行005の方針を維持 |
| 名前一致の誤紐付け | 名前は候補表示だけ。parentが家庭とchild UUIDを明示選択しpreview確認 |
| localStorage改ざん | local値は未信頼入力として型・範囲・サイズをserver検証。local markerを認可根拠にしない |
| 大量ticketを初回import | 子ども画面から直接import不可。recently authenticated parentだけがpreview承認。高額/異常値は追加確認または上限超過レビュー。import後は再import不可でaudit logを残す |
| parent sessionを子ども端末に常駐 | 005 RPCはparent権限なので危険。限定device credential / child操作専用RPCができるまでchild端末自動送信を許可しない |
| event payload差し替え | `event_id` にrequest fingerprintを結び、同ID異payloadを拒否 |
| replay / retry | server unique event IDと原子的RPCでexactly-once effectを保証 |
| XSSでlocal/Auth情報取得 | CSP、依存物監査、出力escape、session保護を別途実施。localStorageを秘密保管庫にしない |
| 古いJSONでcloud巻戻し | restoreはsyncと分離。parent再認証、差分preview、version/child検証、restore audit必須 |

初回import値が真実であることを技術だけで証明することはできない。localStorageは利用者が編集できる。したがって「parentがその値を家庭の初期残高として承認した」という監査モデルにする。parent自身が不正値を承認することまで完全には防げないが、偶発改ざん、子どもだけの改ざん、再importは防止できる。

# Phase plan

## Phase 0: backup仕様と観測基盤

- version付きJSON export / validation / restore previewの設計とテストを先に完成。
- 既存keyを変更せずraw backupを作れることを確認。
- remoteはread-onlyのまま。

完了条件: backupを別環境で検証でき、復元前退避と失敗時無変更が確認できる。

## Phase 1: child mapping + read-only cloud comparison

- parent Auth、家庭選択、明示的child mapping。
- local 6残高とcloud 6残高を並べて比較。
- 書込み、auto merge、既存key削除はしない。

完了条件: 同名childが複数いても誤自動選択せず、他家庭childが候補にもならない。

## Phase 2: idempotent initial balance import

- 最小 `child_app_sync_state` と専用snapshot import RPCを追加。
- backup gate、parent approval、異常値確認、import log 1件、post-read verification。
- rollbackは「local原本へ戻してcloud同期を止める」。既にcloudへ反映した値は自動削除しない。

完了条件: 同じimportを連続・timeout retry・別端末から実行しても残高効果が1回。

## Phase 3: online-only normal sync

- 006で `event_id` 対応。
- 単一残高操作、PAY振替、roulette等の原子的RPCを操作単位で用意。
- RPC成功後にserver snapshotでcache更新。失敗時local確定しない。
- 当初はparent認証中のonline操作に限定。

完了条件: retry、同時更新、部分失敗、stale cache試験を通過。

## Phase 4: secure offline event queue

- confirmed cacheとpending eventsを分離。
- 限定device identity / child操作権限、順序送信、backoff、dead-letter / needs-parent、projected表示。
- 複数端末reconnect試験。

完了条件: timeout、二重click、ブラウザ再起動、長期offline、競合でも二重加算と全体上書きがない。

## Phase 5: HAPICHIKE task/history/backup連携

- task/today taskを同期する必要性を再評価し、専用schemaと原子的完了処理を設計。
- legacy historyは原則local archive。必要なら別archiveへ。
- cloud restore workflowを実装・監査。

## 次に実装すべきPhase

**Phase 0**。`CURRENT_STATE.md` でもJSON backup未実装が移行開始の阻害条件であり、原本保全なしにmapping/importへ進むべきではない。その後Phase 1をread-onlyで実施する。

# Shared family-app architecture

ポッケ共通として切り出せるもの:

- `app_id`、installation/device ID、local profile IDの命名・生成規則
- 親Auth、household membership、child UUIDの明示mapping workflow
- `(child_id, app_id)` 単位のinitial import state
- version付きsnapshot envelope、canonicalization、hash、preview、approval
- event envelope (`event_id`、operation、payload、fingerprint、created_at)
- offline queue、retry/backoff、accepted/rejected/needs-parent状態
- idempotency event ledgerとduplicate response規約
- server snapshot取得、`balance_version`、cache置換、競合/rebase規則
- backup/restore envelope、restore request、監査、rollback運用
- sync status UIの意味（未接続、比較済み、import済み、pending、error）
- RLS原則: childからhouseholdを導出し、caller提供household IDを認可に使わない
- observability: app、child、event、device、request hash、server timestamp（個人情報をログへ過剰保存しない）

共通層は「残高総額を同期する仕組み」ではなく、「認証済みactorが意味のあるidempotent eventを送り、server snapshotを受け取る仕組み」とする。各アプリの残高種類やゲーム規則はadapter/RPC側へ置く。

# HAPICHIKE-specific parts

- local key `kidsVegasCasino.v1` / `kidsVegasCasino.parentEmail.v1` と既存stateのnormalize規則
- `coins` → tickets、`points.snack` → sweets_pay等のfield mapping
- 5スター→1チケット交換規則
- BET 1〜5、0P時チケット返却、ハピチャン獲得/消費/+1Pを含むroulette transaction
- SweetsPAY / ToyPAY / GamePAY間の1:1振替
- task / today task / `ticketGranted` / 午前6時リセット
- ありがとうスターとメッセージ候補
- HAPICHIKEの複数ローカル履歴配列とlegacy import方針
- badges、音設定、親メール、簡易親パスワードの非同期方針

# Recommendation

1. 段階移行Cを採用し、移行完了後はSupabase `child_balances`を残高正本、localStorageをconfirmed cache + pending queue + legacy rollback資産とする。
2. 物理localStorage keyは2個。初回同期は主state内の6残高だけに限定する。
3. childは名前で自動一致せず、parentが家庭内の `children.id` を明示選択する。local mappingは利便性用、server/RLSが認可の根拠。
4. 初回importは専用の原子的snapshot RPCで絶対値設定し、通常increment RPCと分離する。
5. server側unique `(child_id, app_id)`、unique import ID、snapshot hash、import versionで初回importを一度だけにする。
6. 通常操作は `event_id` を必須化し、同一eventの同一payload retryをno-op success、異payloadを拒否する。
7. onlineはRPC成功→返却server snapshotでcache置換。offlineは合計上書きではなくevent queue + pending表示を採用する。
8. 005を複数回呼んでrouletteやPAY振替を表現しない。006でevent id対応と操作単位の原子的RPCを追加する。
9. 過去履歴はcloud台帳へ展開せず、initial import log 1件とJSON原本に残す。
10. JSON restoreはlocal-onlyとcloud restore申請を分離し、古いbackupからの自動cloud上書きを禁止する。
11. 通常競合はserver row lock + idempotent event + server snapshot再取得で解決し、local全体上書きは禁止する。
12. 最小sync metadataは必要。初回import stateと通常event ledgerを役割分離する。
13. 実装順はPhase 0 backup、Phase 1 read-only mapping、Phase 2 initial import、Phase 3 online event sync、Phase 4 offline queue、Phase 5 task/history/restore。
14. 次に着手するのはPhase 0。今回、実装、migration、DB/RPC実行、UI、staging/production、Git commit/pushは行っていない。

# Phase 1 実装結果（2026-10-22）

## 実装範囲

- 親設定に「クラウド連携（比較のみ）」を追加し、現行の単一ローカルプロフィールと、ログイン中ParentがRLS経由で参照できるhousehold内childrenを明示対応付けできるようにした。
- local childは `kidsVegasCasino.v1` の `childName` と6残高から検出する。安定したchild IDや複数child配列は存在しないため、Phase 1専用の擬似キー `legacy-single-profile` を使用する。名前・nicknameによる自動mappingは行わない。
- cloud childrenは、Auth sessionのuser IDに対する `household_members` を起点にhouseholdを取得し、`children` を `household_id` 条件付きで `id, household_id, name, nickname, display_order` のみに限定してSELECTする。
- 選択したchildの `child_balances` は `child_id, tickets, star_coins, sweets_pay, toy_pay, game_pay, happy_chance_cards` のみSELECTする。RPC、INSERT、UPDATE、UPSERT、DELETEはPhase 1 UIから呼ばない。

## mapping metadata

保存先は既存stateと分離した `kidsVegasCasino.cloudMapping.v1`。Auth session、token、email、残高snapshotは保存しない。

```json
{
  "appId": "hapichike",
  "version": 1,
  "mappings": [
    {
      "localChildKey": "legacy-single-profile",
      "supabaseChildId": "<uuid>",
      "householdId": "<uuid>",
      "confirmedAt": "<ISO-8601>"
    }
  ]
}
```

- 同じSupabase childを複数local childへ割り当てる保存は拒否する。
- 保存済みmappingは、現在のAuth sessionから取得した所属householdと、そのhousehold条件付きchildren SELECT結果にchild IDが存在する場合だけ採用する。
- 比較直前と保存直前にもchildrenを再取得する。local metadataは認可根拠にせず、RLSと最新のhousehold所属を認可境界とする。
- localStorageへの書込みはこのmetadata keyだけ。`kidsVegasCasino.v1`、親メール、restore safety、6残高は変更しない。

## balance比較と状態

`coins → tickets`、`starCoins → star_coins`、`points.snack → sweets_pay`、`points.toy → toy_pay`、`points.game → game_pay`、`happyChanceCards → happy_chance_cards` を横並び表示する。差分は **Import candidate = Local − Cloud** と定義し、equal、local greater、cloud greater、cloud balance missingを区別する。cloudに既存値があっても加算・上書きせず、非0ならPhase 2判定を `Cloud already initialized` と表示する。全cloud値が0なら `Ready`、mapping未設定は `Mapping required`、balance行なしは `Cloud balance missing` とする。

未設定、未ログイン、householdなし、childrenなし、mappingなし、balanceなし、不正local JSON/残高、network/API errorを表示し、自動修復しない。

## Phase 2 snapshot payload案

Phase 1 coreは次のpayload案を純粋関数で生成できるが、送信処理は実装していない。`import_id` とcanonical SHA-256はPhase 2で生成・検証する。

```json
{
  "child_id": "<selected-child-uuid>",
  "app_id": "hapichike",
  "import_id": "<phase-2-generated-uuid>",
  "import_version": 1,
  "source_snapshot_hash": "<phase-2-canonical-sha256>",
  "balances": {
    "tickets": 0,
    "star_coins": 0,
    "sweets_pay": 0,
    "toy_pay": 0,
    "game_pay": 0,
    "happy_chance_cards": 0
  }
}
```

Phase 2へ進む前に、専用initial import RPC、server側idempotency/import state、backup gate、cloud既存値またはreward historyがある場合のreconciliation方針が必要。Phase 1は候補payloadを送信しない。

## 検証結果

- unit test: local読込、不正local、4種類の差分、mapping未設定・再確認、mapping保存・再読込、重複禁止、payload案、UI書込みAPI不在、household条件付きchildren取得を対象とする。
- Supabase staging / productionへの接続・変更・RPC実行は行っていない。remoteの `reward_logs` 件数や実データ差分は変更前後とも操作していないため、DB writeは0件。
- productionは未変更。migration 006、event ID、initial import、offline queue、履歴・task同期は未実装。
