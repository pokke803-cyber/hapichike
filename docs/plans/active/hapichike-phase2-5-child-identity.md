# HAPICHIKE Phase 2.5: Child Identity / 複数ローカルプロフィール設計・移行仕様

作成日: 2026-11-01

状態: Phase 2.5A / 2.5B / 2.5C migration core実装済み。通常UI接続と実データ移行は未実装
対象: HAPICHIKE 子ども画面、localStorage、Cloud mapping、backup / restore、Phase 3A bridge

## Scope and non-goals

本書は、安定したローカルChild identity、複数ローカルプロフィール、active child、Cloud mapping、legacy移行、backup / restore、Phase 3再接続の契約を定義する。Phase 2.5Aではidentity/storage primitivesとunit testだけを実装済み。localStorage実データ変換、Supabase migration、DB更新、mapping変更、reward操作、deploy、Git commit / pushは行わない。

現行コードを事実の基準とする。調査時点で `src/online-rewards-core.js`、`src/online-rewards.js`、`tests/online-rewards-core.test.cjs` には未コミット変更があるため、Phase 3A再利用可否は実装開始時にその差分を再監査する。

# Current problem

`kidsVegasCasino.v1` は単一objectであり、`childName` は最大12文字の変更可能な表示名にすぎない。6残高、`tasks`、`todayTasks`、全履歴、設定は1セットしかなく、子どもごとのidentityも選択状態もない。

`kidsVegasCasino.cloudMapping.v1` は配列形式だが、現行コードが返す `localChildKey` は固定値 `legacy-single-profile` だけである。したがってローカルChild A/Cを同時に表現できず、同じ固定キーのmappingは保存時に置換される。Phase 3Aの `resolveMode()` もこの固定キーだけを検索する。

この状態では通常操作がどの子どもの操作か確定できない。特にCloud初期化済みChildについて、`child_id` 未解決時にlocal mutationへ落とすとCloud正本とLocal cacheが分岐する。Phase 3の再開条件は、操作開始時から完了時までidentityが一意かつ不変であることである。

# Identity principles

1. `localChildKey` はプロフィールidentity、`childName` は表示ラベルとし、相互に派生させない。
2. `localChildKey`、Supabase `children.id`、`deviceId`、親Auth user IDは別概念とする。
3. `localChildKey` は生成後に変更・再利用しない。プロフィール名変更、Cloud mapping変更、端末変更で変えない。
4. 1プロフィールは同時に最大1 Cloud Childへ対応し、1 Cloud Childは異なる `localChildKey` 最大1つへ対応する。
5. active childと親dashboardの閲覧Childは別stateとする。
6. identityまたはmappingが曖昧なCloud管理対象操作はfail closedとし、local fallbackしない。
7. legacy、Local、Cloud間のコピー・上書きはpreviewと親の明示承認なしに行わない。
8. `localChildKey` は個人情報や認証情報ではないが、変更不能な識別子として扱う。

# Local child model

推奨形式はWeb Crypto `crypto.randomUUID()` が生成するlowercase UUID v4文字列である。保存例は `8d69d8b1-...` とし、`local-` 等の表示用prefixは付けない。UUID生成機能がない環境ではプロフィール作成を停止し、`Date.now()`、名前、乱数だけの独自IDへfallbackしない。

プロフィールは次のidentity metadataを持つ。

```json
{
  "localChildKey": "<uuid-v4>",
  "createdAt": "2026-11-01T00:00:00.000Z",
  "updatedAt": "2026-11-01T00:00:00.000Z",
  "childName": "表示名"
}
```

`localChildKey` はobject keyと内部値の両方に置き、読込時に一致を検証する。重複、UUID不正、key/value不一致は自動修復せずプロフィールストア全体を安全停止する。JSON backup / restoreでは同じ値を保つため、端末変更後もidentityは変わらない。新規プロフィールとして複製する場合だけ新UUIDを発行し、mappingは複製しない。

`deviceId` が将来必要なら `kidsVegasCasino.device.v1` に端末ごとに別UUIDとして保存し、backup対象外とする。`deviceId !== localChildKey` を必須とし、認証やChild判定には使わない。

# Profile storage model

推奨キーは新規の `kidsVegasCasino.v2`。`kidsVegasCasino.v1` をin-place変換しない。各profile payloadでは既存ロジックの移植リスクを抑えるため、現行のフィールド名とshapeを維持する。

```json
{
  "version": 2,
  "appId": "hapichike",
  "activeLocalChildKey": "<uuid-v4>",
  "profiles": {
    "<uuid-v4>": {
      "localChildKey": "<same uuid-v4>",
      "createdAt": "<ISO-8601>",
      "updatedAt": "<ISO-8601>",
      "childName": "D",
      "coins": 3,
      "starCoins": 1,
      "happyChanceCards": 0,
      "points": { "snack": 0, "toy": 0, "game": 0 },
      "tasks": [],
      "todayTasks": [],
      "history": [],
      "payLogs": [],
      "transferHistory": [],
      "ticketGiftLogs": [],
      "taskHistory": [],
      "starGiftHistory": [],
      "badges": [],
      "lastDailyResetKey": "YYYY-MM-DD"
    }
  },
  "householdShared": {
    "taskMaster": [],
    "categoryMaster": [],
    "rouletteSettings": {},
    "parentSettings": {},
    "dailyResetPolicy": { "hour": 6 },
    "legacyExtras": {}
  },
  "updatedAt": "<ISO-8601>"
}
```

親メールは互換期間中 `kidsVegasCasino.parentEmail.v1` を正本のまま維持する。音設定は家庭・Childではなく端末表示設定なので、Phase 2.5で `kidsVegasCasino.devicePreferences.v1` へ分離する案を採用する。ただし最初のstorage実装では互換adapterにより既存profile内値を読むことも許容する。

保存は「v2全体をparse → schema validation →対象profileだけ更新 → serialize → setItem → readbackして再validation」の順とする。localStorageにtransactionはないため、書込み前raw snapshotを `kidsVegasCasino.profileMigrationSafety.v1` に保持する。通常操作で `kidsVegasCasino.v1` とv2へdual-writeしてはならない。

Phase 2.5完了後のSource of Truthはv2だけとし、v1はread-only safety sourceにする。v2準備前は従来どおりv1だけを読む。起動時の状態機械は `legacy`、`migration-required`、`v2-active`、`migration-failed` のいずれか1つで、v1/v2の値を自動mergeしない。

# Household shared data

現行コードの実態とPhase 2.5での分類は次のとおり。

| データ | 推奨scope | 理由 / 移行方針 |
|---|---|---|
| `parentPassword` | legacy-only / secret-excluded | 親ロックでありChild固有ではないが、平文secretなのでv2へコピーしない |
| `parentEmail` | household shared / local-only | Child固有ではない。互換期間は既存の専用キーを維持 |
| `audioSettings` | device preference | 同じ家庭でも端末ごとに異なり得る。identityやCloud mappingへ含めない |
| task master | household shared | `tasks` の定義部分を共有master候補とし、today assignment/completion/rewardをChild側へ分離する |
| category master | application static | 現行はコード内固定値。localStorageへ複製しない |
| roulette weight / master | application static | 現行はコード内固定値。家庭設定化しない |

task masterはrootに1つだけ保存し、各profileへobject参照または複製を持たせない。取得値はcloneし、変更はrepositoryのroot更新を通す。templateとChildのtoday assignment/completion/reward stateは分離する。

# Child-specific data

最低限、以下はprofile単位で完全分離する。

- identity metadata: `localChildKey`、`childName`、作成・更新日時
- 6残高: `coins`（tickets）、`starCoins`、`points.snack`（SweetsPAY）、`points.toy`（ToyPAY）、`points.game`（GamePAY）、`happyChanceCards`
- `todayTasks`、完了状態、`ticketGranted`
- `history`、`payLogs`、`transferHistory`、`ticketGiftLogs`
- `taskHistory`、`starGiftHistory`
- `badges`
- `lastDailyResetKey`（午前6時reset状態）

独立した `completedTasks` は作らず、現行どおり `todayTasks.status` から導出する。ありがとうスターの残高・候補履歴・付与履歴、ルーレット結果に伴う残高と履歴もChild別である。メモリ上の `activeBet`、`activeCategory`、`latestRouletteResult`、`happyChanceReserved` はChild切替時に必ず破棄・初期化し、別Childへ持ち越さない。

# Active child model

`activeLocalChildKey` は `kidsVegasCasino.v2` のtop-levelに1つだけ保存し、プロフィールobject内へ重複保存しない。起動時は次をすべて満たす場合だけ復元する。

1. UUID形式が正しい。
2. `profiles` に同じkeyが存在する。
3. profile内部の `localChildKey` と一致する。
4. profile schema validationに成功する。

不正または欠落時、profileが1件なら親確認後に選択し直す。2件以上ならChild選択画面を出し、先頭profileへ自動fallbackしない。0件なら親による作成/migration導線だけを出す。

家庭利用の最小安全方式として、次を推奨する。

- 共有端末: 起動時Child選択 + 画面上部に常時名前/色/アイコン表示。残高変更前にもactive keyを内部取得する。
- 専用端末: 親が「この端末ではこのChildを既定」に設定できる。ただし親ロック内から解除可能にし、identity自体は変更しない。
- Child PIN/ID: Phase 2.5では導入しない。家庭内の誤操作防止に対して過剰であり、真の認証にもならない。
- Child切替: 未完了のroulette、modal、reward RPC、draft、選択集合がある間は禁止。切替確認に現在/切替先の表示名を併記し、切替後に全Child固有memory stateをresetする。

親dashboardのCloud Child閲覧選択は別変数（例: `parentViewedSupabaseChildId`）とし、`activeLocalChildKey` を変更しない。親がLocal profileを操作対象に選ぶ画面では、閲覧Childと操作Childを明示的に区別する。

# Cloud mapping model

推奨キーは `kidsVegasCasino.cloudMapping.v2`。v1を上書きせず、migration確認完了後にv2を有効化する。

```json
{
  "appId": "hapichike",
  "version": 2,
  "mappings": [
    {
      "mappingId": "<uuid-v4>",
      "localChildKey": "<uuid-v4>",
      "supabaseChildId": "<uuid>",
      "householdId": "<uuid>",
      "status": "active",
      "confirmedAt": "<ISO-8601>",
      "lastVerifiedAt": "<ISO-8601>",
      "verifiedChildName": "<display-only snapshot>"
    }
  ],
  "updatedAt": "<ISO-8601>"
}
```

`verifiedChildName` は確認画面用snapshotでidentity判定には使わない。active mappingの利用前に毎回またはsession再開時に、Auth session、家庭membership、`children.id`、`children.household_id`、app sync stateを再検証する。`lastVerifiedAt` だけを信頼してrewardを許可しない。

mapping解除はLocal/Cloudデータを削除せず、v2からactive mappingを除去して、理由・旧ID・時刻を秘密情報なしのローカル監査履歴へ残す。mapping変更は「解除」と「新規mapping」を一操作に見せず、旧Cloud/Local残高比較、未処理操作なし、親再認証、明示確認を経た二段階操作とする。

# One-to-one constraints

保存前validationで次を拒否する。

- 同じ `localChildKey` のactive mappingが2件以上
- 同じ `supabaseChildId` のactive mappingが異なる `localChildKey` に2件以上
- profile storeに存在しない `localChildKey`
- 選択householdに属さない、またはSELECTできないSupabase Child
- UUID、appId、version、timestamp不正
- household IDとChild rowの `household_id` 不一致

保存処理は既存documentを再読込し、全体validation、書込み、readback validationを行う。UIのdisabledだけを制約にしない。

Local A→Cloud AをCloud Cへ変更する安全条件は、(1)進行中RPC/queueなし、(2)旧mapping再検証、(3)A/Cloud A/Cloud Cの6残高比較、(4)Cloud Cが他local keyで未使用、(5)Cloud Cのhousehold検証、(6)親の再承認、(7)旧mapping解除後もデータ無変更、(8)新mapping後に再照合、である。Cloud初期化済みならreconciliation完了までrewardを停止する。

localStorageだけでは別端末にある異なる `localChildKey` と同じCloud Childの重複を検出できない。将来Cloud側にmapping registryを設ける場合、`(app_id, local_child_key)` と `(app_id, child_id)` の一意制約を置く。同じ `localChildKey` をrestoreした複数端末は同一profile identityとして許容できるが、異なるlocal keyは拒否する。これは将来のSupabase migration対象であり、本Phaseの文書作成では追加しない。

# Legacy migration

`legacy-single-profile` をA/C両方へコピーしてはならない。移行状態機械と順序は次のとおり。

1. **Preflight**: v1 raw JSON、既存mapping v1、localStorage空き、UUID生成、backup機能を検証する。破損時は停止する。
2. **Backup**: 現行version 1 backupを書き出し、アプリ自身で再parse・validationした記録を作る。ファイル保存を親が確認する。
3. **Migration safety**: v1 raw値と親メールを `kidsVegasCasino.legacySafety.v1` にread-only envelopeとして保存し、readbackする。
4. **Preview**: 名前、6残高、task/today/history件数、親設定、既存legacy mapping、Cloud比較を表示する。まだ書かない。
5. **Owner selection**: 「この端末の現在データは誰のものですか？」で1人だけを親が選ぶ。表示名一致から自動選択しない。Cloud Child選択は別stepとする。
6. **Profile generation**: UUID v4を1つ発行し、v1 child-specific stateをそのprofileへ1回だけコピーする。親設定をsharedへ移す。追加Childを同じsnapshotから作らない。
7. **Write/readback validation**: v2全体を書き、identity、全配列、6残高、件数、active key、checksum相当のcanonical JSONを読み戻して比較する。
8. **Activation**: validation成功後だけ `v2-active` markerを確定する。v1は変更・削除しない。
9. **Mapping decision**: profile作成後に別画面でv1 mappingを表示する。親が同じCloud Childであると再確認し、家庭・Child・残高を再検証した場合だけ新keyへmapping候補を作る。自動継承しない。
10. **Completion**: migration記録にsource backup時刻、source fingerprint、新local key、完了時刻を残す。Cloudへは書かない。

`kidsVegasCasino.v1` と `kidsVegasCasino.legacySafety.v1` は少なくともPhase 2.5全段階とrestore試験完了まで保持する。v2有効化後は読み取り専用で、通常起動、reward、backupの正本に使わない。削除は将来の別承認事項とする。

新しい2人目以降のprofileは空の6残高とdefault tasksから作るか、明示的にtask templateだけをコピーする。legacyの残高・history・today stateはコピーしない。

# Existing Cloud data protection

Phase 2.5はLocal profile作成とCloud mappingを分離し、Supabase RPC/INSERT/UPDATE/DELETEを一切行わない。Child A/Cの既存Cloud残高、sync state、reward logsを変更しない。

Child CはPhase 2 initial import済みでCloud残高 tickets 3、star 1、その他0がSource of Truthである。Child Cへmappingする候補profileのLocal値が異なる場合は、Local/Cloud/diffを表示しreconciliation未完了としてrewardを停止する。自動upload、自動download、自動mergeは禁止する。

Phase 2完了Childでは選択肢の意味を次のように限定する。

- **Cloudを正として接続**: 親がbackupと比較を確認後、将来のbridge activation時にCloud 6残高を当該Local profileのcacheへ反映する。Local task/historyは保持する。
- **Localを保持**: mappingを有効化せずlocal-onlyのまま保つ。Cloudへ自動反映しない。
- **Local値をCloudへ反映したい**: 通常mappingでは実行せず、別の監査付きbalance correction仕様/RPCを要求する。Phase 2.5/3Aの範囲外。

よって「どちらを正とするか」をアプリが推測しない一方、initial import完了済みChildへ同期接続する条件としてはCloud正本方針を維持する。

# Backup / restore

## Backup v2

```json
{
  "format": "hapichike-backup",
  "version": 2,
  "createdAt": "<ISO-8601>",
  "app": "hapichike",
  "data": {
    "profileStore": {
      "version": 2,
      "activeLocalChildKey": "<uuid-v4>",
      "profiles": {},
      "householdShared": {}
    },
    "parentEmail": "parent@example.com"
  },
  "cloudLinks": {
    "included": false
  }
}
```

全profiles、active key、Child別data、非secret household shared data、親メールを含める。`parentPassword`、Auth token/session、service role、staging資格情報、pending reward/initial import payload、`deviceId` は除外する。

active mappingは既定で含めない。household/cloud IDは個人データかつrestore先でstale/越境になり得るためである。将来exportする場合も「無効なmapping候補」として別sectionに入れ、restore後にAuth、household、Child、1対1制約、Cloud差分、親承認を経るまで有効化しない。

## Restore v2

restoreは全profile一覧、active child、6残高、task/history件数、既存Localとの差分をpreviewする。書込み直前に現行v2 safety backupを作り、全体を1回で書き、readback validation失敗時はraw値へ戻す。Cloud APIは呼ばない。restore後のmappingはすべて未接続状態とし、既存端末mappingも自動で別profileへ付け替えない。

## Restore v1 to v2

v1 backupを直接active v2 storeへ上書きしない。通常のLegacy migration wizardへ入力し、backup内の単一profileの所有者を親が1人だけ選び、新UUIDを発行して新規v2 profileとしてimportする。現在端末に同じmigration source fingerprintがある場合は重複importを警告・拒否する。

既存v2 profilesがある場合は、v1から「新規profileを1件追加」のpreviewに限定する。既存profileへの自動merge/置換、複数profileへのコピー、mapping復元、Cloud pushは禁止する。現在端末自身のv1からの初回移行で既に発行済みlocal keyを安全記録から確認できる場合だけ同じkeyを再利用し、それ以外は新UUIDとする。

# Reward flow after Phase 2.5

```text
user action
  -> capture activeLocalChildKey
  -> validate active profile
  -> resolve mapping by that exact localChildKey
  -> revalidate session + household membership + visible child + sync state
  -> capture immutable operation context
     { localChildKey, supabaseChildId, profileRevision }
  -> commitReward
  -> transactional RPC
  -> fetch Cloud balance
  -> verify active/profile context is unchanged
  -> update only that profile's 6-balance cache
  -> append success history for that profile
```

操作中のChild切替は禁止する。完了時にactive keyまたはprofile revisionが変わっていれば、別profileへ結果を適用せずCloud再取得を要求する。

Cloud mappingが存在する、initial import完了済み、またはCloud管理フラグが立つprofileでは、child ID/session/network/household/visibility/sync stateのいずれかが不明なら操作全体を失敗させる。local mutation、成功履歴、音/演出上の成功確定を行わない。

mappingが一度もなくCloud未管理と明示された純local profileだけはlocal-only操作を許可できる。ただし「mapping missing」だけから純localと推測せず、profileに明示的なsync mode（`local-only` / `cloud-managed` / `reconciliation-required`）を持たせる。mapping解除後のCloud管理profileをlocal-onlyへ自動降格させない。

Phase 4 event契約は最低限次を持つ。今回はqueueを実装しない。

```json
{
  "event_id": "<uuid>",
  "app_id": "hapichike",
  "localChildKey": "<uuid>",
  "supabaseChildId": "<uuid>",
  "type": "ticket",
  "amount": 1,
  "category": null,
  "created_at": "<ISO-8601>",
  "deviceId": "<optional uuid>"
}
```

# Failure / rollback

| 段階 | failure時 | rollback先 |
|---|---|---|
| Preflight / backup / preview | 書込みなしで停止 | v1現状 |
| safety copy作成 | 移行停止 | v1現状 |
| v2生成・書込み | v2をactiveにせず、書込み前raw v2を復元 | v1 + safety copy |
| readback validation | activation markerを付けず、自動rollback | v1 + safety copy |
| v2 activation後 | v1へ自動dual-writeしない。問題時はrewardを停止し、親承認でsafety snapshotからv2再構築 | v1/safetyはread-only原本 |
| mapping v2 migration | v1 mappingを変更せず、v2候補を無効化 | mapping v1 + v2書込み前raw |
| reconciliation | mappingをactiveにせず、Local/Cloudを変更しない | unmapped / blocked |
| Phase 3 RPC前失敗 | Local mutationなし | 操作前profile |
| RPC成功・cache取得失敗 | Cloudをrollbackしたと推測しない。profileをstale/blockedにして再取得 | Cloud正本 |

rollbackは「古いv1を再び通常正本として書き始める」ことではない。v2 activation後の障害では操作を停止し、保存済み原本からv2を再構築する。Cloud commit後のclient failureは逆RPCで即席補償せず、Cloud readbackと監査logで確定する。

# Security considerations

- 表示名、端末ID、配列indexをidentityに使わない。
- UUIDは推測困難性を持つが認可ではない。Cloud認可はSupabase Auth、household membership、RLS/RPCで行う。
- 親passwordは現行どおり簡易ロックで、強い認証ではない。平文保存の既知リスクを明記し、Cloud/backupへ出さない。
- mapping保存時・利用時の両方でhousehold境界を再検証する。
- restore由来のCloud ID/mappingを信頼しない。
- backupには子どもの名前・履歴・親メールが含まれるため、個人データとして扱う。
- localStorageは同一origin scriptから読める。XSS対策と依存コード監査が必要であり、local UUIDで秘密を保護できるとはみなさない。
- Child切替とreward実行をmutexで直列化し、操作contextを途中で差し替えない。

# Test matrix

| # | Case | 必須結果 |
|---:|---|---|
| 1 | legacy single profile | v1無変更、1人だけのpreviewが出る |
| 2 | 2 local profiles | UUIDが別、両profileを同時保持 |
| 3 | name変更 | local key/mapping/残高が不変 |
| 4 | Child切替 | 表示と参照profileだけ切替、draft/roulette memory reset |
| 5 | active key保持 | 再起動後、存在・整合するkeyだけ復元 |
| 6 | A/C残高分離 | A操作でCの6残高が不変 |
| 7 | task分離 | Aの追加/編集/今日状態がCへ波及しない |
| 8 | history分離 | A操作logがCに出ない |
| 9 | mapping A→A | household再検証後だけactive |
| 10 | mapping C→C | A mappingを保持したままactive |
| 11 | duplicate Cloud mapping | A→Cloud A後のC→Cloud Aを保存層で拒否 |
| 12 | wrong household | UIと保存/resolveの双方で拒否 |
| 13 | mapping missing | local-only明示profileのみlocal操作可。Cloud管理profileはblocked |
| 14 | mapping stale | reward前再検証でblocked、local fallbackなし |
| 15 | legacy migration | backup→preview→owner選択→1 profile→readback→activate |
| 16 | migration failure rollback | v1/safetyが不変、v2 inactive |
| 17 | v1 backup restore | wizardで1新profile、既存profileへ自動mergeなし |
| 18 | v2 backup restore | 全profile/active復元、mapping無効、readback成功 |
| 19 | Child C既存Cloud保護 | tickets 3/star 1/他0をPhase 2.5が変更しない |
| 20 | reward child解決 | active key→mapping→Cloud childが一致 |
| 21 | child ID不明 | RPC/local mutation/history成功確定なし |
| 22 | legacyをA/Cへ選択 | 2人目へのコピーを拒否 |
| 23 | duplicate local key | store validation失敗、起動を安全停止 |
| 24 | active key不在 | 先頭へfallbackせず選択画面 |
| 25 | 切替中RPC | 切替禁止、別profileへcache適用なし |
| 26 | mapping変更 A→C | 旧解除、比較、再承認、reconciliation必須 |
| 27 | Local/Cloud diff | 6行のLocal/Cloud/diff表示、自動上書きなし |
| 28 | Cloud RPC成功後fetch失敗 | Localを成功値と推測せずstale/blocked |
| 29 | shared device | 起動選択、常時Child表示、誤操作防止 |
| 30 | dedicated device | 既定Child復元、親ロックで解除可能 |
| 31 | task template copy | 候補だけ明示コピー、残高/history/todayはコピーなし |
| 32 | v2 restore mapping metadata | 自動active化なし、household越境なし |
| 33 | 6時reset | active profileだけreset、他profileのkey不変 |
| 34 | profile削除 | mapping/残高/history存在時に強い警告と別backup必須 |
| 35 | UUID APIなし | 独自ID fallbackせず作成停止 |

# Phase breakdown

## 2.5A — Identity/storage primitives（最初に実装）

- UUID生成・validation
- v2 schema validator / serializer
- profile repositoryとactive key resolver
- 既存payload field名を維持するadapter
- unit testのみ。UI切替、migration、Cloud接続なし

最初に実装すべき最小Phaseは2.5Aである。identityを先に固定しない限り、migration・mapping・rewardのどれも安全に組み立てられない。

## 2.5B — Backup v2 and migration safety

- all profiles backup/preview/restore core
- v1→v2 import preview core
- safety copy、readback、rollback test
- まだv1を変換しない

## 2.5C — Legacy migration wizard

- backup gate、所有者選択、1 profile生成
- v2 activation state machine
- v1 read-only保持
- Cloud writeなし

## 2.5D — Multi-profile UI / active child

- 起動時選択、切替、専用端末既定
- Child固有memory reset、常時identity表示
- profile別save/loadと6時reset

## 2.5E — Mapping v2

- v1 mapping preview、v2 schema、一対一validation
- household/Child再検証、解除/変更警告
- Local/Cloud diff表示
- Cloud mutationなし

## 2.5F — Reconciliation gate

- `local-only` / `cloud-managed` / `reconciliation-required` の明示状態
- initial import済みChildのCloud正本採用フロー
- Child C保護試験

## 2.5G — Phase 3 bridge reconnect

- captured active keyを `commitReward` へ渡す
- mapping/sync再検証、fail closed
- Cloud balanceを対象profileだけへ反映
- stagingでA/C分離試験後に限りPhase 3A再開

各Phaseを独立reviewし、前Phaseのbackup/rollback/testが完了するまで次へ進まない。

# Phase 3A reusable components

現行Phase 3Aから概念または小さなpure functionとして再利用可能なのは次である。

- 6残高のLocal/Cloud field mappingと比較ロジック
- `createRewardEvent` のtype/amount/category validation（`event_id` と `localChildKey` の追加が必要）
- server balanceのvalidationと現行fieldへの変換
- action lockの考え方（lock keyへ `localChildKey` を含める必要あり）
- RPC wrapper選択: ticket、star coin、exchange、PAY、Happy Chance
- session、household membership、visible Child、initial import完了の再検証
- RPC後にCloud balanceを再取得してcacheへ反映する流れ
- safe error messageと「失敗時に成功を確定しない」方針

そのまま再利用できない部分は、固定 `legacy-single-profile` を検索する `resolveMode()`、単一global `state` に適用する処理、mapping missingを暗黙local modeとする判定、Child contextを持たないlock keyである。また現行 `executeRewardMutation` には特定条件でlocal fallbackを許す分岐があるため、Cloud管理profileのfail-closed契約へ書き換える必要がある。PAY振替とrouletteの複数RPCは部分成功のatomicity問題が残るため、Phase 3再開前に複合RPCまたは明確な補償不能設計を別途決める。

# Future common family-app model

他アプリでも共通化できる概念は次である。

- stable `localChildKey` と変更可能なdisplay nameの分離
- `deviceId`、Local Child、Cloud Child、Parent Authの分離
- `activeLocalChildKey` を持つprofile store
- household shared / child-specific / device preference / app staticの4 scope
- one-to-one mappingとhousehold再検証
- backup、migration preview、readback、rollback、mapping無効restore
- Cloud-managed操作のfail-closed event context

HAPICHIKE Phase 2.5で共通ライブラリは作らない。まずHAPICHIKE内の契約とtest vectorsを確立し、SPACE POLICE ACADEMY、Task Quest、MoziBeet、発掘バスターズで2つ以上の実例が揃った時点で、schema vocabularyとpure validatorだけを抽出する。残高・task・game ruleは各アプリ固有plugin/domainとして残す。

# Final decisions

1. **推奨localStorage schema**: 新規 `kidsVegasCasino.v2` のtop-levelに `activeLocalChildKey`、`profiles`、`householdShared`。profile内部は現行field名を維持する。
2. **localChildKey形式**: `crypto.randomUUID()` のUUID v4。作成後不変、名前/Cloud/deviceから独立。
3. **activeLocalChildKey保存**: v2 top-levelに1つ。起動時にprofile存在・内部key一致・schemaを検証し、不正なら選択を要求。
4. **Child個別データ**: 6残高、名前、today assignment/completion、全reward/task/history、badges、Childごとの6時reset状態。
5. **家庭共通データ**: task master、非secret親設定、6時境界policy。親passwordはv2から除外し、親メールは互換期間中専用keyを維持。category/rouletteの現行値はapp static、音はdevice preference。
6. **Cloud mapping schema**: `kidsVegasCasino.cloudMapping.v2` にUUID local keyとSupabase child/household、確認・再検証metadataを複数保持。
7. **1対1制約**: local keyとCloud child双方をactive mapping内でuniqueにし、保存時/利用時に全体とhouseholdを再検証。別端末横断の保証は将来Cloud registryが必要。
8. **legacy-single-profile移行**: backup、safety、preview、親の所有者1人選択、新UUID profile、readback、activate。A/C両方へコピー禁止。
9. **Child C保護**: Phase 2.5はCloud writeゼロ。既存3 tickets/1 star/他0をCloud正本とし、差分解消までreward停止。
10. **Local/Cloud不一致**: Local/Cloud/diffを表示し自動上書き・mergeなし。initial import済みChildへ接続するならCloud採用を明示承認、Local採用は別correction仕様。
11. **backup v2**: 全profiles、active key、非secret shared dataを含める。password/token/device ID/pending payload/mappingは除外。
12. **restore v1→v2**: legacy wizardで所有者1人を選び、新規profile 1件として追加。自動merge、複製、mapping復元なし。
13. **Phase 3 child解決**: action→captured active local key→profile→mapping→再検証済みSupabase child→RPC→Cloud再取得→同じprofile cache更新。
14. **child ID不明時**: Cloud管理profileは操作失敗。local mutation/成功履歴/成功演出なし。
15. **device共有**: 起動時Child選択、常時identity表示、切替時draft reset。専用端末は親が既定Childを固定可能。
16. **推奨Child選択**: 共有端末はA（起動時選択）、専用端末はC+D（親が端末既定を割当）。Child PINは当面不要。
17. **rollback**: v1とlegacy safetyをread-only保持。各writeはraw snapshot→readback→activate。Cloud commit後はCloud再取得し逆操作を推測しない。
18. **Phase分割**: 2.5A identity/storage、B data classification/domain adapter、C legacy migration。UI、mapping、reconciliation、Phase 3 bridgeはその後の明示承認工程。
19. **最初の実装**: 2.5A。pure schema/identity/profile repositoryとtestだけ。
20. **Phase 3A再利用**: balance mapping/validation、event validation、locks、RPC wrappers、Auth/household/Child/sync再検証、Cloud readback。固定key/global state/local fallbackは置換。
21. **他アプリ共通化**: identity/scope/mapping/backup/fail-closed概念とvalidatorだけを後で抽出。今は共通ライブラリを作らない。

# Open decisions before implementation

- profile削除をPhase 2.5に含めるか。含めるならbackup、mapping解除、Cloud管理状態に応じた強い制約が必要。
- 専用端末既定をv2 top-levelだけで表すか、別device preference keyにするか。本書は後者を推奨する。
- task masterの共有分類はPhase 2.5Bで決定済み。Phase 2.5Cでlegacy `tasks[].status` を除いた変換とmigration previewを確定する。
- 別端末横断の1対1を保証するCloud mapping registryの要否とmigration時期。
- Phase 3のPAY振替/rouletteをatomicにする複合RPC契約。
- Cloud正本をLocal cacheへ採用するreconciliation UIの最終文言と監査metadata。

# Implementation readiness

2.5A（identity/storage primitives）の実装開始は可能。ただしPhase 3A再開は不可。2.5A〜F、特にLegacy migration、mapping v2、Child C reconciliation、fail-closed testが完了してから2.5Gへ進む。

# Phase 2.5A implementation

2026-11-01にidentity/storage primitivesを独立moduleとして実装した。既存アプリからは未接続であり、`kidsVegasCasino.v1` からのmigration、UI、Cloud mapping、Supabase、reward bridgeは実行しない。

- `src/child-identity-core.js`: UUID生成、v2 schema、profile/store validation、parse/clone helper
- `src/profile-repository.js`: root object単位のprofile read/write API
- `tests/profile-repository.test.cjs`: identity、分離、破損、readback、v1/mapping保護test

# v2 schema

保存keyは `kidsVegasCasino.v2`。rootは `version: 2`、`appId: "hapichike"`、`activeLocalChildKey`、`profiles`、`householdShared`、`updatedAt` を必須とする。profile payloadは設計どおり既存field名を維持し、`coins`、`starCoins`、`happyChanceCards`、`points.snack/toy/game`、各task/history配列、`lastDailyResetKey` を持つ。

v2 keyが存在しないreadは、memory上の空storeを返すだけでlocalStorageへ書かない。profile作成が最初のv2書込みとなるが、Phase 2.5Aでは既存UIから呼ばれないため自動作成されない。

# Repository API

- `createRepository(storage, options)`: storage、Web Crypto、clockを依存注入
- `createProfile({ childName })`: `crypto.randomUUID()` でprofileを新規作成。外部指定keyは受け付けない
- `getProfile(localChildKey)`: cloneまたは`null`
- `getAllProfiles()`: profile cloneの配列
- `updateProfile(localChildKey, patch)`: identity/createdAtを固定した更新
- `setActiveLocalChild(localChildKey | null)`: 存在するprofileまたは`null`だけを保存
- `getActiveLocalChild()`: active profile cloneまたは`null`
- `removeProfile()`: Phase 2.5Aでは常に拒否
- `readStore()`: validation済みclone。破損storeを自動修復しない

# Validation

root version/app ID、plain object、dangerous key、UUID v4、object keyと内部keyの一致、active key参照、required fields、配列、日時、全残高のfinite numberを検証する。`NaN`、`Infinity`、`__proto__`、`prototype`、`constructor` を拒否する。UUID生成APIがなければprofile作成を失敗させ、`Math.random()` や日時由来IDへfallbackしない。

# Safety guarantees

更新ごとに現在のv2をparse/validateし、cloneへ変更し、root全体をvalidateして1回だけ書き、raw一致と再parseを行う。readback失敗時は書込み前のv2 raw値を復元する。v1、`kidsVegasCasino.cloudMapping.v1`、他のlocalStorage keyは参照・変更せず、`localStorage.clear()`を使わない。

repositoryはUI、backup v2、Cloud API、Phase 3Aへimportされていない。したがってこのPhase単独ではブラウザ起動時の動作・legacy state・Cloud state・reward flowを変更しない。

# Tests

専用testではUUID作成、名前変更時identity維持、2 profile共存、6残高分離、active key、malformed store、finite number、重複key、write/readback/rollback、corrupted storage、v2未作成read、v1/mapping v1 byte-equivalent、削除禁止、安全でないUUID fallback禁止、Cloud/reward非接続を確認する。全体の既存testとbuildもPhase完了時に実行する。

# Next Phase 2.5C

Phase 2.5Cのmigration core、preview、fixture testは実装済み。通常UIへの接続、実ユーザーlocalStorageでの実行、Cloud mapping、Supabase変更、Phase 3再開は含めていない。

# Phase 2.5B data classification

調査日: 2026-11-01。正本は `index.html` の `loadState()` / `normalizeState()` / 更新処理である。Phase 2.5Bは `kidsVegasCasino.v1` を読まず、書かず、削除せず、実移行もしない。`kidsVegasCasino.v2` の `version` は2のまま維持する。

Phase 2.5Aのフラットな保存shapeは移行容易性と後方互換性のため維持する。`src/profile-domain.js` が `balances / tasks / history / progress / resetState` のdomain viewを提供し、同じ残高や履歴を別shapeへ二重保存しない。

## 現行v1主要field監査

| 現行field / state | 実コード上の役割 | 分類 |
|---|---|---|
| `childName` | 最大12文字の表示名 | CHILD_SPECIFIC |
| `coins` / `starCoins` / `points.snack/toy/game` / `happyChanceCards` | 6残高 | CHILD_SPECIFIC |
| `tasks` | task定義。title/icon/category/difficulty/rewardとlegacy `status`が同居 | HOUSEHOLD_SHARED（定義）/ LEGACY_ONLY（status） |
| `todayTasks` | 今日の割当、status、完了時刻、報酬snapshot、`ticketGranted` | CHILD_SPECIFIC |
| `history` | 一般、task完了、roulette、reset、交換等、最大40件 | CHILD_SPECIFIC |
| `payLogs` / `transferHistory` / `ticketGiftLogs` | PAY使用/振替/親チケット付与、各最大50件 | CHILD_SPECIFIC |
| `taskHistory` | 検索用task snapshotと`completedCount`、最大80件 | CHILD_SPECIFIC |
| `starGiftHistory` | ありがとうスターmessage候補、最大20件 | CHILD_SPECIFIC |
| `badges` | achievement/progress | CHILD_SPECIFIC |
| `lastDailyResetKey` | Childの今日状態を処理済みにした6時境界key | CHILD_SPECIFIC |
| `parentPassword` | 平文簡易lock | LEGACY_ONLY / secret-excluded |
| v1内 `parentEmail` | 専用keyがない場合のfallback | LEGACY_ONLY |
| `audioSettings` | BGM/SFX ON/OFF・音量 | DEVICE_LOCAL |
| `kidsVegasCasino.parentEmail.v1` | 親メールの現在の正本 | HOUSEHOLD_SHARED相当。ただし専用keyを維持 |
| `activeLocalChildKey` | この端末で選択中のprofile | DEVICE_LOCAL（v2 root metadata） |
| `defaultTasks`, `taskCategories`, `categories`, `betTables` | code固定定義 | application static。v1 fieldではない |
| tab/category/BET/modal/draft/spinning等 | 一時UI/session state | DEVICE_LOCAL。profileへ保存しない |

独立した `completedTasks` fieldはない。完了は `todayTasks[].status === "done"`、`completedAt`、`ticketGranted` と `history` / `taskHistory.completedCount` に表現される。roulette専用配列もなく結果は `history` に文章として入る。

# Child-specific data

- identity metadata: `localChildKey`, `childName`, `createdAt`, `updatedAt`
- 6残高: `coins`, `starCoins`, `points.snack/toy/game`, `happyChanceCards`
- assignment/completion/reward snapshot: `todayTasks`
- `history`, `payLogs`, `transferHistory`, `ticketGiftLogs`, `taskHistory`, `starGiftHistory`
- `badges`, `lastDailyResetKey`

# Household-shared data

v2 rootの `householdShared` にだけ置き、profileへ複製しない。

- `taskMaster`: v1 `tasks` の定義部分
- `categoryMaster`: 将来家庭編集を許す場合のschema。現行固定categoryはコピーしない
- `rouletteSettings`: 将来家庭設定化する場合のschema。現行 `betTables` はコピーしない
- `parentSettings`: 非secret設定専用
- `dailyResetPolicy.hour`: 家庭全体の1日の境界。現行値6
- `legacyExtras`: 家庭共通と判定した未知fieldの欠損防止領域
- 親メールは概念上家庭共通だがPhase 2.5Bでは専用keyを変更・コピーしない

# Device-local data

- `activeLocalChildKey`
- `audioSettings`（将来の `kidsVegasCasino.devicePreferences.v1` 候補）
- 最後に開いたtab/category/BET、modal、入力draft、選択集合
- roulette進行中state (`spinning`, `rotation`, `latestRouletteResult`, `happyChanceReserved`)
- 将来の `deviceId`。profile identityには使わない

# Legacy-only data

- `tasks[].status`: masterに混在した旧UI状態。割当/完了の正本にしない
- `todayTasks[].status === "inProgress"`: 読込互換値。現行UIに開始操作なし
- v1 object内 `parentEmail`: 専用keyのfallback
- `parentPassword`: v1に残すがv2 profile/householdSharedへ移さない
- Phase 2.5A profile内 `tasks`: 保存shape互換のため残るが2.5B adapterではChild assignmentとして扱わない

UNDECIDEDは実コードで意味を確定できない未知field。Phase 2.5Cで `legacyExtras` に原shapeを保持し、監査なしに捨てない。Auth/access/refresh token、service role、staging credentialは `legacyExtras` にも入れずmigrationを停止する。

# v1 → v2 mapping table

| v1 source | v2 destination / 方針 |
|---|---|
| `childName` | `profiles[key].childName` |
| `coins` | `balances.tickets`（raw `profiles[key].coins`） |
| `starCoins` | `balances.starCoins`（raw `profiles[key].starCoins`） |
| `points.snack` | `balances.sweetsPay`（raw `profiles[key].points.snack`） |
| `points.toy` | `balances.toyPay`（raw `profiles[key].points.toy`） |
| `points.game` | `balances.gamePay`（raw `profiles[key].points.game`） |
| `happyChanceCards` | `balances.happyChanceCards`（raw `profiles[key].happyChanceCards`） |
| `tasks[]` 定義 | `householdShared.taskMaster[]`。legacy `status`は除外してaudit |
| `todayTasks[]` | `tasks.assignments`（raw `profiles[key].todayTasks`） |
| `history[]` | `history.rewardLog`（raw `profiles[key].history`） |
| `payLogs[]` | `history.payUsage`（raw `profiles[key].payLogs`） |
| `transferHistory[]` | `history.payTransfers`（raw `profiles[key].transferHistory`） |
| `ticketGiftLogs[]` | `history.ticketGifts`（raw `profiles[key].ticketGiftLogs`） |
| `taskHistory[]` | `history.completedTasks`（raw `profiles[key].taskHistory`） |
| `starGiftHistory[]` | `history.thankYouStarMessages`（raw `profiles[key].starGiftHistory`） |
| `badges[]` | `progress.badges`（raw `profiles[key].badges`） |
| `lastDailyResetKey` | `resetState.lastDailyResetKey`（raw `profiles[key].lastDailyResetKey`） |
| `audioSettings` | device preference候補。profileへ移さない |
| `parentPassword` | 移行禁止。v1にのみ残す |
| v1内 `parentEmail` | 移行しない。専用keyを維持 |
| 未知の非secret field | scope判定後profile/householdの `legacyExtras`。原key/valueを保持 |

# Profile domain schema

adapterの論理shape。raw保存はPhase 2.5Aのフラットfieldを維持する。

```json
{
  "balances": { "tickets": 0, "starCoins": 0, "sweetsPay": 0, "toyPay": 0, "gamePay": 0, "happyChanceCards": 0 },
  "tasks": { "assignments": [] },
  "history": { "rewardLog": [], "payUsage": [], "payTransfers": [], "ticketGifts": [], "completedTasks": [], "thankYouStarMessages": [] },
  "progress": { "badges": [] },
  "resetState": { "lastDailyResetKey": "" }
}
```

新規profileは6残高0、全Child配列空、badge空、reset key空。getterはdeep cloneを返し、setterは新objectを返す。repositoryだけが保存する。

# Household shared schema

```json
{
  "taskMaster": [],
  "categoryMaster": [],
  "rouletteSettings": {},
  "parentSettings": {},
  "dailyResetPolicy": { "hour": 6 },
  "legacyExtras": {}
}
```

Phase 2.5Aの `householdShared: {}` も読込可能。新規storeと最初のshared更新から上記defaultを使う。version 3や内部revisionは追加しない。

# Domain adapter

`src/profile-domain.js`:

- `getBalances(profile)` / `setBalances(profile, patch)`
- `getChildTasks(profile)` / `updateChildTasks(profile, patch)`
- `getChildHistory(profile)` / `appendChildHistory(profile, channel, entry, limit)`
- `getProgress(profile)` / `updateProgress(profile, patch)`
- `getResetState(profile)` / `updateResetState(profile, patch)`
- `getHouseholdShared(root)` / `updateHouseholdShared(root, patch)`
- `BALANCE_MAPPING` / `HISTORY_FIELDS`

`src/profile-repository.js` は `setBalances`, `updateChildTasks`, `appendChildHistory`, `updateProgress`, `updateResetState`, `getHouseholdShared`, `updateHouseholdShared` を公開する。更新は全store validation、write、readback、失敗時rollbackを通る。

Balance対応は `BALANCE_MAPPING` 1箇所に定義した。Phase 3Aの `online-rewards-core.js` と `cloud-mapping-core.js` に既存変換があるが、今回はPhase 3A変更禁止のため差替えていない。再開時にこの定義へ統合する。

# Task classification

| 概念 | 現行対応 | scope |
|---|---|---|
| A. task master | `tasks[]` のid/title/icon/category/difficulty/reward/default属性 | HOUSEHOLD_SHARED |
| B. Child assignment | `todayTasks[]` のtaskIdと追加時snapshot | CHILD_SPECIFIC |
| C. Child completion | `todayTasks[].status/completedAt/ticketGranted` | CHILD_SPECIFIC |
| D. reward result | `todayTasks`報酬snapshot、`history`、6残高 | CHILD_SPECIFIC |

`taskHistory` は検索候補snapshotとChildの `completedCount` が同居するため、2.5Cでは分解せずChild historyとして保持する。全面正規化はしない。

# History classification

- reward/ticket/roulette/reset/交換/general: `history`
- PAY使用: `payLogs`
- PAY振替: `transferHistory`
- 親チケット付与: `ticketGiftLogs`
- task完了集計/検索snapshot: `taskHistory`
- ありがとうスター候補: `starGiftHistory`

すべてChild-specific。rouletteは専用schemaがなく一般history textに含まれるため、2.5Cで再解釈せず原entryを保持する。

# Settings classification

- 家庭共通: task master、将来のcategory master/roulette override、非secret親設定、6時境界policy
- Child個別: badges/progress、today/completion、`lastDailyResetKey`
- Device local: audio、tab/category/BET/modal/draft、active child selection
- application static: 現行category/bet table。v1 migration対象外
- secret-excluded: parent password、Supabase Auth/access/refresh token、service role、staging credentials

# 6時reset分類

家庭全体の境界policyは `householdShared.dailyResetPolicy.hour = 6`。Childごとの処理済み境界は `profiles[key].lastDailyResetKey`、今日状態と完了状態は `profiles[key].todayTasks`。reset時にtask masterは消さない。現行 `tasks[].status` をidleへ戻す処理はlegacy UI stateであり、共有masterの永続状態に移さない。

# Unmapped legacy data

Phase 2.5Cは既知field allowlistとsecret denylistでpreviewする。未知のsafe valueは捨てず、Child scopeならprofile側、家庭scopeなら `householdShared.legacyExtras` へ原key/valueを保持する。scope不明は `UNDECIDED` としmigration完了扱いにしない。dangerous key、非finite number、plain object/array以外、credential疑いは書かず停止する。

# Phase 2.5C prerequisites

- v1 raw snapshotとparent emailのsafety backup/readback
- known/unknown/secret field inventory preview
- task masterからlegacy statusを分ける決定的変換
- legacy ownerを1 profileだけに選ぶ親確認
- profile/household `legacyExtras` の具体的raw schema
- v1 byte-equivalent確認とv2 rollback試験
- Cloud mapping v1を自動継承しないこと
- 本分類、とくにtask master共有とChild assignment/completion/reward分離のレビュー承認

# Phase 2.5C migration contract

`src/profile-migration.js` は `kidsVegasCasino.v1` だけをlegacy sourceとして読み、`kidsVegasCasino.v2` へ新規profileを1件追加するlocal-only coreである。通常UIからはimportせず、自動実行しない。呼出側は親が選んだ `targetDisplayName` を明示する必要があり、sourceの `childName` から移行先を推測しない。profile keyはapply時にWeb CryptoのUUID v4を新規発行し、`legacy-single-profile` は使用しない。

v1、`kidsVegasCasino.cloudMapping.v1`、親メール専用keyは書換え・削除しない。Supabase、RPC、network、reward bridgeへ接続しない。既存v2がある場合はprofilesとshared fieldを保持し、新profile追加だけを候補にする。

# Preview

`previewLegacyMigration(storage, options)` はread-only dry-runで、localStorage writeは0件。target display name、source child name、6残高、today件数、assignment件数、完了状態、全history channel件数、badge、reset state、task master件数、legacyExtras件数、除外secret/device field名、merge conflict、duplicate状態を返す。

未知fieldは自動分類しない。`legacyFieldScopes: { fieldName: "profile" | "household" }` で明示されたsafe fieldだけを対応する `legacyExtras` へ原形保持する。未分類fieldは `UNDECIDED` 相当の `legacyExtras.undecided` に表示し、`canApply = false` とする。値はpreview/logへ出さない。

# Safety backup

apply直前に `kidsVegasCasino.identityMigrationSafety.v1` を作る。envelopeはmigration version、作成時刻、source key、source hash、秘密情報を再帰除外したv1 source、除外field名を持つ。`parentPassword` の値、Auth/session/token/service role/staging credentialは含めない。safety write後にraw一致をreadbackする。失敗時はv2を書かない。v1 raw自体が最終のbyte-equivalent sourceとして残る。

# Source hash

v1をdangerous key・plain JSON・finite number検査後、object keyを辞書順にしたcanonical JSONへ変換し、SHA-256 hexを計算する。property順や空白だけの差は同じhashになる。preview tokenはmigration version、source hash、target display name、legacy field scopesから生成する。apply時に再読込・再計算し、preview後にsourceまたは選択条件が変化していれば書込み前に拒否する。

# Apply flow

`applyLegacyMigration(storage, options)` は有効なpreview tokenを必須とし、次の順で処理する。

1. v1再読込、構造・secret・dangerous value検査
2. source hash/token再計算、duplicate・未分類・conflict検査
3. safety copy作成とreadback
4. UUID v4発行、target profileとshared merge candidate生成
5. v2全体validation
6. v2を1回書込み、raw一致とschemaをreadback validation
7. migration metadata、v1 raw、cloudMapping v1 rawの不変確認
8. validation成功済みprofileだけをactive childとして確定

metadataはv2 rootの `identityMigrations[]` に `{ migrationVersion, migratedAt, source: "legacy-single-profile", targetLocalChildKey, sourceHash }` として保存する。metadata自体もschema validationし、target profile参照とsource hash重複を検査する。

# Merge rules

- `profiles`: 新UUID keyを追加する。既存keyは変更しない。
- `taskMaster`: task `id` 単位。同一ID・同一canonical valueは再利用し、新IDは追加する。
- taskの定義fieldだけをmasterへ置き、legacy `status` は `householdShared.legacyExtras.taskStatuses` へ分離する。
- `todayTasks` と完了・報酬snapshotはtarget profileだけへ置き、masterへ複製しない。
- `parentSettings`、category master、roulette settings等の既存shared fieldは保持する。
- `dailyResetPolicy` は現行契約 `{ hour: 6 }` と一致するときだけ維持する。
- shared/profileのlegacyExtrasはkey単位。同じkey・同じvalueは再利用し、新keyは追加する。

# Conflict handling

同じtask IDで定義が異なる、reset hourが6でない、同じlegacyExtras keyで値が異なる場合はpreviewの `conflicts` にpathを返す。自動選択・上書き・部分移行は行わずapplyを拒否する。Phase 2.5C coreにはconflict解決APIを設けないため、将来UIで親が内容を確認し、sourceまたは既存shared dataを別の明示操作で整理してからpreviewを作り直す。

# Idempotency

`identityMigrations[].sourceHash` に同じhashがあればno-opではなく明確に拒否する。既存のtarget keyと完了時刻はpreviewへ返す。同じv1 snapshotから別UUID profileを作らない。metadataの同一source hash重複もv2 schema validationで拒否する。

# Rollback

v2書込み前rawをmemoryに保持する。write/readback/schema/metadata/invariant確認のいずれかが失敗した場合、v2を直前rawへ戻し、以前v2がなければkeyを削除する。したがって既存profilesと以前の `activeLocalChildKey` は復元される。v1とcloudMapping v1はcoreが変更しない。作成済みsafety copyは調査・手動復旧用に保持する。

成功後に手動rollbackが必要な場合は、通常UIを停止し、migration metadataのtarget keyとsource hashを確認した上で、migration直前に別途保存したv2 backupへv2全体を復元する。v1からの再移行だけで既存v2を上書きしてはならない。target profileだけを削除するrepository APIはPhase 2.5Cでは提供しない。

# Test matrix

`tests/profile-migration.test.cjs` はvalid preview、dry-run write 0、UUID、6残高、task master/assignment、全history channel、reset、legacyExtras、secret除外、nested credential拒否、dangerous key、非finite/malformed source、safety copy、成功/readback/active key、v1/mapping不変、既存profile保持、safe merge/conflict、duplicate、source変更、rollback、Cloud/UI非接続をfixtureだけで検証する。Phase 2.5A/BとPhase 0/1/2/3Aの既存testも全体 `npm test` で回帰確認する。

# Phase 2.5D prerequisites

- 親ロック内のmigration wizardと「この端末の現在データは誰のものか」の明示選択UI
- preview全項目、unknown scope、conflictを値漏えいなく表示するUI
- migration実行前のversion 1ファイルbackup保存確認
- apply二重操作防止、失敗時のsafety key案内、成功後のreload/state machine接続
- 実データを複製した隔離環境でのfixture外受入試験
- v2 backup/restoreと成功後rollback運用の実装・確認
- Cloud mappingは引き続き自動継承せず、Phase 2.5D以降の別preview・親確認とする
