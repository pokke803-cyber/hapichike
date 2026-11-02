# HAPICHIKE Parent UX integration design audit

作成日: 2026-11-02
状態: P1 Parent runtime read-only統合完了。Phase 2.5D migration実行停止中
変更境界: `/parent` read-only adapter/UIのみ。localStorage write、Supabase write、migration実行、production deployを行わない

## Decision summary

Parent Authを必要とするCloud管理は `/parent` の単一Parent runtimeへ集約する。子ども側の「おうちの人用」には、現在の端末で完結する日常的なローカル設定だけを残す。localStorageを扱うbackup、restore、legacy migrationも、認証済みの親がCloud Childを確認しながら行う管理操作として `/parent` へ移す。ただし処理本体は既存coreを再利用し、UI移設のためにロジックを書き直さない。

`parentViewedSupabaseChildId`（Parent Cloud管理対象）と `activeLocalChildKey`（子どもアプリで現在操作中のLocal profile）は別stateであり、相互に自動同期しない。mapping画面だけが両者を明示的なペアとして扱う。

現行のPhase 2.5D migration UIをこのまま本体親設定内で実行可能にする作業は停止する。移設設計、runtime統合、read-only preview、隔離データでの受入確認が終わるまで実データmigrationを実行しない。

# Current split architecture

現在は同じ機能領域に2つの親UIと3つのCloud state ownerがある。

1. 子どもアプリ `/` の「おうちの人用」
   - `state.parentPassword` のローカル簡易ロックを使う。
   - task master編集、報酬設定、PAY振替、チケット付与、親メール、backup/restoreを扱う。
   - Cloud mapping / initial snapshot import UIとPhase 2.5D legacy migration UIも同じmodal内に追加されている。
   - `cloud-mapping-ui.js` が開くたびにParent session、Household、Child候補、Cloud残高、sync state、reward logを独自に取得する。
   - `profile-migration-ui.js` も別stateを持ち、同じ情報を再取得する。

2. `/parent` の「みまもりダッシュボード」
   - Supabase Parent Authを所有する。
   - `parent/parent.js` の単一stateで `user → householdId → childId` を管理する。
   - Household A、Child A/C、Cloud残高、reward履歴を正常取得できる。
   - 現在は閲覧専用で、localStorage、mapping、migration、backup/restoreを扱わない。
   - Cloud連携リンクは `/#parent-cloud` へ戻すため、Cloud管理を続けるには別UIへ遷移する。

3. 共通API/core
   - Auth、Household、Child、reward APIは `src/services/api/` にある。
   - 候補取得は `cloud-child-candidates.js`、Local/Cloud処理はmapping、initial import、profile、migration、backupの各coreに分かれている。
   - coreの多くはUIから分離済みだが、UI orchestrationと選択stateは統合されていない。

現在の典型導線は、子どもアプリのローカル親ロック解除 → Cloud画面 → `/parent` でログイン → 子どもアプリへ戻る → 別runtimeでsessionと候補を再取得 → mapping/migration、である。

# Problems

Cloud Child候補が本体側だけ空になりやすいのは、DB上にChildがないことよりも、同じ前提条件を別runtimeで再構築する設計に原因がある。

- `/parent` の `householdId` / `childId` はメモリ内stateであり、本体のCloud UIへ渡されない。
- mapping UIとmigration UIがそれぞれ独立した `session → household_members → households → children` chainを実行する。
- 画面遷移後のsession復元、Auth refresh、RLS、network、Household初期選択のどこか1段でも失敗するとchildren取得まで到達しない。
- 「sessionなし」「membership 0件」「household 0件」「children 0件」「取得エラー」が最終的に似た空候補として見えやすい。
- mapping UIは保存済みmappingのHouseholdを優先する一方、`/parent` は現在stateまたは先頭Householdを選ぶ。選択元が一致しない可能性がある。
- Phase 2.5D UIはCloud ChildをLocalデータ所有者確認に使うが、Cloud選択の正本が `/parent` ではない。
- Parent Authとローカル簡易パスワードが同じ「親」導線に並び、認証境界が利用者に見えにくい。
- Cloud error/connection stateも各UIに分散し、成功済みの `/parent` stateを再利用できない。

対策は候補取得の再試行を増やすことではなく、Parent Auth、Household、Cloud Child選択、Cloud read modelを `/parent` の1 runtimeに集約することである。

# Parent-only responsibilities

分類記号は A = 子どもアプリ本体の親設定、B = `/parent`、C = UI非依存の共通moduleである。複合表記は「UI owner + 共通core」を示す。

| 機能 | 分類 | 推奨owner / 境界 |
|---|---|---|
| Parent login | B + C | `/parent` がlogin、logout、reset、Auth state subscriptionを所有。`authApi`を再利用する |
| Household取得 | B + C | Parent runtimeが1回取得し、Cloud管理タブ全体へcontext提供。`householdsApi`を再利用する |
| Child一覧 | B + C | 選択Householdに対してParent runtimeが取得。`childrenApi`を再利用する |
| Child切替 | B | `/parent` の唯一のCloud Child選択stateとする |
| Local / Cloud比較 | B + C | Parent選択Cloud Childと明示選択Local profileを比較。比較関数はcore化/再利用する |
| Cloud mapping | B + C | mapping UIは `/parent`。document validation、一対一制約、保存/readbackはcoreを再利用する |
| 初回snapshot import | B + C | Parent Auth、role、Cloud未初期化確認、承認、RPCを同じruntimeで完結する |
| legacy → v2 migration | B + C | 同一originのLocal管理タブへ移す。Cloud writeは禁止し、既存migration coreを使う |
| backup | B + C | Local管理タブへ移す。migration/import gateと同じbackup metadataを使う |
| restore | B + C | Local管理タブへ移す。Cloudへ自動反映せず、preview、明示承認、safety copyを維持する |
| task master編集 | A + C | 現行はローカル日常設定なので本体に残す。将来Cloud正本化する場合は別設計 |
| 親password | A / B | ローカル簡易ロックの `parentPassword` はA。Supabase account password/resetはB。統合・同期しない |
| reward履歴 | A / B + C | Local履歴は本体、Cloud reward logは `/parent`。表示変換だけ共有可能 |
| Cloud残高表示 | B + C | `/parent` の選択Childに従う。子ども画面へCloud管理用selectorを置かない |
| 将来のスター評価 | B + C | Parent Authが必要な評価/確定は `/parent`。子ども側の依頼表示だけAに置ける |
| 将来の親承認 | B + C | `/parent` が承認者・対象Child・監査記録を一貫して保持する |
| Phase 3 sync状態 | B + C | 詳細状態、reconciliation、再試行は `/parent`。子ども画面は操作に必要な最小statusのみA |
| error / connection状態 | B + C / A | Cloud詳細診断は `/parent`。本体は「Cloud管理が必要」等の非機密な影響表示だけにする |

# Child-app responsibilities

子どもアプリは `activeLocalChildKey` を正本として、現在選択中のLocal profileの日常操作を扱う。

- Local profileの起動時選択と切替
- task masterの追加・編集・削除とローカル報酬設定
- ローカル親メール、端末設定、簡易親ロック
- 子どもの残高、タスク、ルーレット、ごほうび、Local履歴
- Child切替時のmodal、roulette、draft、選択集合等のメモリreset
- Phase 3でCloud管理profileを操作する場合の最小sync status表示とfail-closed
- `/parent` の該当Local管理画面への一方向リンク

本体親設定からはParent login、Household selector、Cloud Child selector、mapping、initial import、Cloud比較、Cloud詳細診断、legacy migration実行UIを除く。backup/restoreもParent管理の入口を一本化するため `/parent` へ移す。移行期間中に旧ボタンを残す場合は、新UIへのlinkだけとし、二重実装を維持しない。

# Shared domain modules

次のmoduleはUIを移しても書き直さず、`/parent` からimportして使う。

- `src/services/api/authApi.js`
- `src/services/api/householdsApi.js`
- `src/services/api/childrenApi.js`
- `src/services/api/rewardsApi.js`
- `src/services/api/historyApi.js`
- `src/services/cloud-child-candidates.js`
- `src/initial-import-core.js`
- `src/cloud-mapping-core.js`（v1固定identity部分はv2対応が必要）
- `src/child-identity-core.js`
- `src/profile-repository.js`
- `src/profile-domain.js`
- `src/profile-migration.js`
- `src/profile-migration-ui-core.js`
- `src/backup-core.js`（現状version 1のみ。v2 backupは拡張が必要）
- Phase 3のbalance mapping、validation、RPC wrapper、safe error、readback flow

`cloud-child-candidates` は独立画面ごとのstate ownerにはせず、Parent runtimeの初期load/refresh helperとして使う。API/coreは共有し、DOM参照、modal event、各画面固有stateは移設または薄いadapterへ置換する。

再利用見積りは、domain/API/coreが約80〜90%、現在の本体内Cloud UI orchestration/DOMが約20〜40%、移設全体で約60〜70%である。これは行数の確定値ではなく設計見積りである。固定 `legacy-single-profile`、global `state` 前提、DOM ID、hash/modal event、Local fallbackはそのまま再利用できない。

# Auth ownership

`/parent` の最上位に `ParentRuntime`（名称は実装時決定）を1つ置き、以下を保持する。

```text
authStatus
parentUserId
households
selectedHouseholdId
cloudChildren
parentViewedSupabaseChildId
cloudReadState / connectionState
```

初期化は `getParentSession()` → `onParentAuthStateChange()` → membership/Household取得 → Child取得の1系統だけにする。各管理タブはこのcontextを受け取り、個別にlogin確認からやり直さない。Cloud write直前は既存の安全契約どおりsession、membership、role、visible Childを再検証するが、これはUI stateの再構築ではなくauthorization preflightである。

Supabase sessionは同一origin上のSDK永続storageにより `/` と `/parent` で利用可能だが、本体側がParent Auth runtimeを持つ理由にはしない。login後は `/parent` 内でCloud管理を完結させ、「本体へ戻ってsessionを再確認する」導線を廃止する。

ローカル `parentPassword` はSupabase Authとは別の簡易誤操作防止である。account passwordへ昇格、同期、Cloud保存、同値化をしてはならない。

# Household ownership

Parent runtimeが `selectedHouseholdId` を唯一所有する。Household変更時はCloud Child一覧、選択Child、balance、reward log、mapping候補、sync stateをまとめてinvalidateし、当該Householdのデータだけを再取得する。

選択は現在sessionのmembershipとRLSで毎回検証する。複数Householdがある場合だけselectorを表示し、保存済みmappingを理由に別Householdへ暗黙切替しない。mapping画面から特定Householdを要求する場合も、Parent runtimeへ明示的な選択要求として渡し、所属確認後に切り替える。

# Parent Child selection

`parentViewedSupabaseChildId` をParent Cloud管理の唯一のCloud Child選択stateにする。dashboard、Cloud残高、reward log、mapping、initial import、将来の評価/承認、Phase 3管理画面はすべてこの値を参照する。

- Household変更時はnullへ戻し、取得後もParentの明示選択を要求する。
- mappingやmigrationの破壊的操作では、表示中Childを暗黙承認に使わず、確認画面に名前とIDの短縮表示を出して再確認する。
- P0/P1はmemory-onlyとし、sessionStorage/localStorageへ永続化しない。将来の永続化は別変更で再設計し、Auth tokenを独自保存しない。
- Child切替中は古いrequest結果をload token/AbortController等で破棄する。
- Child選択をLocal active profileへ伝播させない。

# Local Child identity

`activeLocalChildKey` は `kidsVegasCasino.v2` が所有するLocal identityであり、子どもアプリの現在操作対象を示す。`parentViewedSupabaseChildId`、Supabase Auth user ID、Household ID、`deviceId`とは別物である。

Parent Local管理画面では必要に応じて `parentSelectedLocalChildKey` を別stateとして持つ。mapping画面は次の2列を明示する。

```text
Local profile: parentSelectedLocalChildKey
Cloud Child:   parentViewedSupabaseChildId
Mapping:       明示承認された1対1 relation
```

Cloud Child切替で `activeLocalChildKey` を変更しない。Local profile切替でCloud Childを自動推測しない。名前一致をidentityとして使わない。legacy v1はまだstable local keyを持たないため、migration apply時にcoreがUUID v4を発行する。

# Migration UI placement

Phase 2.5D legacy migration UIは `/parent` の「この端末のデータ」または「Local / Cloud連携」配下へ移せる。現行構成では `/` と `/parent/` は同じcanonical originであり、pathはlocalStorage境界ではないため、`/parent` から `kidsVegasCasino.v1`、`kidsVegasCasino.v2`、mapping、backup metadataを読める。

推奨フローは次である。

1. Parentが `/parent` で1回loginする。
2. Parent runtimeがHouseholdとCloud Child A/Cを取得する。
3. ParentがCloud Childを選ぶ。
4. Local管理タブが同一originのlegacy v1をread-onlyでinspectする。
5. 既存migration coreでpreviewを作る。
6. Local/Cloud 6残高をread-only比較する。
7. backup current、所有者、preview、Cloud非更新の確認を満たす。
8. 親の明示操作で `applyLegacyMigration()` を1回だけ実行する。
9. v1とCloudを変更していないこと、v2/safety copy/readbackを検証する。

このmigrationはLocal v2作成だけを行い、Cloud write、mapping保存、initial import、Cloud補正を行わない。既存の `profile-migration.js` と `profile-migration-ui-core.js` を再利用し、現行 `profile-migration-ui.js` のDOM/state orchestrationだけをParent runtime adapterへ置換する。

同一origin条件は scheme、host、portがすべて同じことである。`https://example.com/` と `https://example.com/parent/` は共有できるが、別subdomain、別port、`http`/`https`差、別WebView、外部origin iframeでは共有できない。cross-origin iframeではStorage Access制限やpartitioningもあり、直接migration UIの前提にしない。別origin化する場合は、親が明示的に作成したJSON backupのfile import/exportを境界とし、`postMessage`でraw storageを渡さない。

# Backup placement

backup/restoreは `/parent` のLocal管理タブへ置く。理由はmigrationとinitial importの直前gateであり、親の明示確認、対象Local profile、対象Cloud Child、Cloud非更新の説明を同じcontextで提示できるためである。

- version 1は既存 `backup-core.js` をそのまま利用する。
- v2 multi-profile backup/restore coreはPhase 2.5D通常利用開始前の必須条件とする。
- backupはAuth session/tokenを含めない。
- restoreは常にLocal-onlyとし、Cloudへの自動push、mapping自動復元、active Cloud Child変更をしない。
- restore後にCloud管理profileとの不一致が生じる場合は `reconciliation-required` とし、Phase 3 rewardをfail closedにする。
- 子どもアプリ側の旧「データ管理」は移行期間後に削除し、必要なら `/parent` へのlinkだけを残す。

# Cloud mapping placement

Cloud mappingは `/parent` の選択Household/Child context内へ移す。mapping UIはCloud selectorを独自に持たず、Parent headerの選択Childを対象とする。Local側だけを明示選択し、Local/Cloud比較、一対一validation、保存確認を行う。

既存 `cloud-mapping-core.js` の比較、parse、verified mappingは再利用する。ただし現行v1の固定 `legacy-single-profile` はPhase 2.5Eのv2 mapping schemaへ置換が必要である。保存前と利用前に、Local profile存在、Household membership、Child可視性、Childの `household_id`、重複mappingを検証する。

mappingはidentity relationであり、データcopyではない。保存/解除/変更でLocal/Cloud残高を変更せず、initial importやreconciliationを自動開始しない。

# Phase 3 integration

Phase 3ではUI ownerとreward execution contextを分ける。

- `/parent` はCloud管理状態、mapping、initial import、reconciliation、詳細error、親承認を所有する。
- 子どもアプリは操作開始時にcaptured `activeLocalChildKey` を持ち、profile repositoryからmappingを解決する。
- Cloud-managed profileはsession、membership、visible Child、mapping、sync stateを再検証し、曖昧ならlocal fallbackせずfail closedにする。
- Parent headerの `parentViewedSupabaseChildId` は子どものreward mutation対象を決めない。mutation対象はLocal active profileの検証済みmappingだけで決まる。
- Cloud readbackは対象Local profileだけへ反映する。
- sync状態は `local-only`、`cloud-managed`、`reconciliation-required`、`blocked/error` を明示する。
- PAY振替やrouletteの複数RPC atomicity、event ID/idempotency、offline queueは別途決定する。

# Migration path from current UI

1. Phase 2.5Dの実データapplyと本体側UI拡張を停止する。既存core/testは保持する。
2. `/parent` にParent runtime contextを導入し、現dashboardが同じcontextで動くことを確認する。
3. Cloud管理機能をread-onlyから順に移す。Cloud残高/履歴 → Local読取 → Local/Cloud比較 → mapping previewの順とする。
4. backup/restore UIを既存coreの薄いadapterとして移し、v1互換を確認する。
5. legacy migrationをまずpreview-onlyで移し、同一origin storage、Child A/C選択、Cloud非更新を確認する。
6. mapping、initial importを移し、write直前preflightと既存RPC contractを維持する。
7. 隔離コピーでmigration apply/rollback/readbackを受入確認した後だけ、実行可否を別承認する。
8. 本体側Cloud/migration/backup UIを `/parent` linkへ置換し、二重state ownerをなくす。
9. v2 active profile UI、mapping v2、reconciliation、Phase 3 bridgeを順に再開する。

移行中もCloud Child selectorを両UIに残さない。新 `/parent` 機能が未完成なら、旧UIを並行稼働させずCloud write/applyを停止したままにする。

# Minimal implementation phases

## P0 — Freeze and contracts

- Phase 2.5D apply、mapping変更、initial importの実行境界を確認する。
- Parent/Local/Cloud identity用語とstate名を固定する。
- v2 backup/restore、rollback、acceptance条件を決める。
- コード変更前にChild A/Cとlegacyデータの隔離fixtureを用意する。

## P1 — Parent runtime unification

- `/parent` にAuth/Household/Cloud Child/context/error stateを1つだけ置く。
- 現dashboardをそのcontextへ接続する。
- Child A/C切替とrequest race、session refresh、RLS errorを確認する。

## P2 — Read-only Local/Cloud management

- 同一origin localStorageのpresence/validationだけを `/parent` で行う。
- backup status、Local profile一覧、Local/Cloud比較、migration previewをread-only表示する。
- このPhaseではlocalStorage/Cloud writeを行わない。

## P3 — Local safety operations

- backup/restore adapterとv2 backup contractを実装する。
- legacy migration applyは隔離データでrollback/readbackを検証する。
- 本番実データでのapplyは別の明示承認まで無効のままにする。

## P4 — Cloud management move

- mapping v2、initial import、sync state、詳細errorを `/parent` へ移す。
- write直前のAuth/role/Household/Child再検証を維持する。
- 本体の旧Cloud UIをlinkへ置換する。

## P5 — Multi-profile and Phase 3 reconnect

- 子どもアプリのactive Local Child UIとprofile別save/loadを接続する。
- reconciliation gateを導入する。
- Child A/C分離試験、duplicate/idempotency試験後にPhase 3を再開する。

## Maximum risks

最大リスクは、Parent Cloud選択とLocal active identityを混同し、誤ったChildへmapping、initial import、restore後のCloud write、またはPhase 3 rewardを行うことである。これは残高と履歴の誤帰属を生み、後から安全に自動mergeできない。

次点は、同一originであることを理由に `/parent` がLocalデータへ無制限に作用し、Cloud管理画面の操作が子どもアプリのactive profileを暗黙変更することである。Local writeは明示的なLocal管理操作、preview、backup、承認、readbackを必須とする。

## Decisions required before implementation

- `/parent` の最終route/tab構成（runtime contextのP0 state contractは下記で確定）
- migration所有者確認にCloud Child選択を必須とするか、Cloud未利用家庭向けLocal-only経路を用意するか
- v2 backup format、全profile/単一profile restore、mappingをbackup対象外にする最終契約
- restore後の `reconciliation-required` 判定とPhase 3停止条件
- mapping v2のstorage schema、別端末重複を防ぐCloud registryの要否
- task masterを当面local-onlyに保つ期間と、将来Cloud正本化する場合のowner
- ローカル簡易親passwordの変更UI、失効、役割。Supabase passwordと統合しないこと
- initial import後のLocal source of truth切替時点
- Cloud Child削除/移動、membership失効、session expiry時のUX
- PAY振替/rouletteのatomicity、Phase 3 event id/idempotency、offline方針
- 本番migration applyを有効化する受入試験、担当者、rollback手順

結論として、Phase 2.5Dを現行の分裂UI上で続行すべきではない。coreとtestは保持し、Parent runtime統合と `/parent` へのread-only移設を先に行う。実データmigrationはP0〜P2の設計・検証が完了し、P3の隔離受入試験と別承認を通るまで停止する。

# Parent Runtime Contract

P0の正本は `src/parent/parent-runtime-core.js` とする。moduleはDOM、Supabase client、Web Storageへ依存しないpure coreであり、入力stateを変更せず新stateを返す。P1の `/parent` adapterだけが既存APIを呼び、結果をcoreへ渡す。

```text
auth: { status, userId, errorCode }
connection: { status, errorCode }
households: { status, items, errorCode }
selectedHouseholdId
cloudChildren: { status, items, errorCode }
parentViewedSupabaseChildId
viewedChildData: { status, errorCode }
viewedChildBalance
viewedChildRewardLogs
local: {
  legacyStatus, v2Status,
  activeLocalChildKey, activeLocalChildExists,
  profileCount,
  errorCodes
}
```

runtime公開stateにsession、access token、refresh token、password、secret、SQL、stackを保持しない。P0はstate transitionとgateだけを定義し、UI接続、storage write、Cloud writeを行わない。

# Auth State

Auth statusは `loading | signed_out | signed_in | error` とする。`signed_in` のときだけHousehold loadを開始でき、公開する認証情報はnon-emptyな `userId` だけとする。Parent Authのownerは `/parent` runtimeであり、本体の簡易親passwordとは統合しない。signed-outまたはAuth errorではHousehold、Cloud Child選択、残高、履歴をinvalidateする。

# Household State

Household statusは起動前を表す `not_loaded` に加え、`loading | ready | empty | error` とする。0件は `empty` でChild取得を開始しない。1件だけならIDで自動選択できる。複数件では `selectedHouseholdId` をnullのまま保ち、Parentの明示選択を要求する。一覧外IDは `HOUSEHOLD_NOT_FOUND` で拒否する。

# Cloud Child State

Cloud Child statusは `not_loaded | loading | ready | empty | error` とする。list read modelは一覧に必要な `id | householdId | displayName | displayOrder` だけを持ち、balanceとreward logは選択後に別取得する。現行schemaの `children.name` はadapter入力であり、read modelでは `displayName` へ正規化する。他Householdのrowが混入した結果は受理しない。

# Parent Viewed Child

唯一のCloud閲覧選択は `parentViewedSupabaseChildId` であり、nullを許容する。`cloudChildren.items` にあるIDだけを設定できる。名前、display order、Local profile、mappingから自動選択しない。Household変更、signed-out、Child一覧error、更新後のstale selectionではnullへ戻し、残高と履歴も破棄する。Child一覧が1件でもP0 coreはCloud操作対象を暗黙選択しない。

保存方式は **Parent runtime memory-only** で確定する。P0/P1ではsessionStorage/localStorageへ保存しない。将来sessionStorageを導入する場合は別変更として `householdId + childId` をnamespaced keyへ保存し、Auth・membership・一覧可視性を復元時に再検証する。Auth tokenは独自保存しない。

# Local Identity State

P0のLocal readerはread-onlyで、呼出側から渡されたraw値を既存validatorで検証する契約とする。legacy v1とv2はそれぞれ `success | missing | invalid`。v2から公開する選択情報は `activeLocalChildKey` と、そのkeyが同じstoreのprofilesに存在するかだけである。P1/P2 adapterはv2検証に `child-identity-core.parseStore`、legacy previewに既存migration/backup validatorを再利用する。core自身は `localStorage.getItem` も実行しない。

Local missing/invalidはCloud Child一覧取得を停止しない。Cloud errorもLocal読取結果を上書きしない。

# Identity Separation Rules

`parentViewedSupabaseChildId` と `activeLocalChildKey` は別のidentity、別のstate ownerである。どちらを選択・解除しても他方を変更しない。display name一致による推定、Cloud Child先頭の操作対象化、mapping変更によるLocal切替、Local active keyからCloud Childへの反映を禁止する。

Local profileとCloud Childはmappingが存在するときだけrelationとして表示する。mappingなしでも両一覧を独立に取得・表示できる。Parent runtimeの閲覧Childは、Phase 3の子どもreward mutation対象を決めない。

# Fail Closed Rules

Cloud write gateは次のいずれかで閉じる。

- Authがsigned-inでない
- connection error
- Householdがreadyでない、未選択、または一覧外
- Cloud Child一覧がreadyでない、未選択、stale、またはcross-household
- 操作にmappingが必要なのにverifiedでない
- 操作にLocal identityが必要なのに確定していない

local fallbackによるCloud操作継続は禁止する。P0 coreはgate判定だけを提供し、write APIを持たない。

# Error Model

安定codeは `AUTH_REQUIRED`、`AUTH_LOAD_FAILED`、`HOUSEHOLD_NOT_FOUND`、`HOUSEHOLD_LOAD_FAILED`、`CHILD_LOAD_FAILED`、`CHILD_SELECTION_INVALID`、`LOCAL_V1_INVALID`、`LOCAL_V2_INVALID`、`MAPPING_REQUIRED`、`CONNECTION_FAILED` とする。adapterは技術例外をstage別にcodeへ変換し、UIはcodeを安全な文言へ変換する。公開stateへ例外message、stack、token、SQLを入れない。

# Runtime Actions

P0で固定するaction contractは以下である。

- `initializeParentRuntime()`
- `selectHousehold(id)`
- `selectViewedCloudChild(id)`
- `refreshCloudChildren()`
- `refreshViewedChildData()`
- `readLocalIdentityState()`
- `resetViewedChild()`

P1 adapterは `authApi` → `householdsApi` → `childrenApi` の順に既存read APIを呼ぶ。選択後だけ `rewardsApi` / `historyApi` を呼ぶ。`cloud-child-candidates` の既存membership/Household/Child chainは、独立UI state ownerとしてではなく初期load/refresh helperとして統合する。同じqueryを新規実装しない。

# P1 Prerequisites

- `/parent` にruntime ownerを1つ置き、現行 `parent/parent.js` の分散stateをadapterへ置換する
- Auth listenerの古い結果、Household/Child切替中の古いrequest結果をload tokenまたはAbortControllerで破棄する
- 複数Householdでは明示選択、Childは明示選択とし、空とerrorを別表示する
- `parentViewedSupabaseChildId` はmemory-onlyを維持する
- Local readerは同一originからread-onlyで接続し、P1ではlocalStorage writeを行わない
- Cloud write、mapping変更、initial import、migration apply、Phase 3再開は引き続き無効にする
- Child A/C、Parent B/Child B、重複display name、cross-household、stale responseのfixtureで回帰確認する

P0完了時点ではUIは未接続であり、実データ・保存key・DB・RLS・migrationに変更はない。P1はこのcontractへ現dashboardのread-only orchestrationを接続する工程である。

# P1 Runtime Adapter

`src/parent/parent-runtime.js` を単一orchestratorとして追加し、既存の `authApi`、`householdsApi`、`childrenApi`、`rewardsApi`、`historyApi` とP0 pure coreを接続した。adapterは依存注入可能で、DOMやSupabase clientを直接所有しない。公開stateにはsession/token/技術例外を格納しない。

# Initialization Flow

`getParentSession` → Auth確定 → `getCurrentHouseholds` → Household確定 → 1件時だけHousehold自動選択 → `getChildrenByHousehold` → Cloud Child確定 → Local v1/v2 readの順で初期化する。複数Householdでは明示選択までChild取得を待つ。Local read失敗・missing・invalidはCloud取得結果を変更しない。

# Cloud Child Selector

`/parent` dashboardのselectorだけが `parentViewedSupabaseChildId` を更新する。Childは明示選択とし、先頭Childを暗黙選択しない。表示順は `display_order`。Household変更時は以前のChild選択・残高・履歴を破棄し、新Householdの一覧を取得する。`activeLocalChildKey` は変更しない。

# Viewed Child Data

Child選択後だけ `child_balances` と `reward_logs` の既存SELECT APIを並列取得する。詳細stateは `not_loaded | loading | ready | error`。loading開始時とerror時に旧残高・旧履歴を消し、古いChild dataを現在値として表示しない。

# Local Read-only State

同一originの `kidsVegasCasino.v1` と `kidsVegasCasino.v2` を `getItem` だけで読む。v1は既存backup validator、v2は `child-identity-core.parseStore` で検証する。runtimeにはstatus、`activeLocalChildKey`、active key存在、profile件数だけを保持する。`setItem`、`removeItem`、`clear` は使用しない。

# Refresh

`refreshCloudChildren()`、`refreshViewedChildData()`、`readLocalIdentityState()` を画面reloadなしで実行できる。Cloud Child refresh中は詳細をclearし、一覧結果が同じHouseholdに属することを再検証する。request generationによりAuth、Child一覧、詳細のstale responseを破棄する。

# Error Handling

API例外はP0の安定codeへ変換し、UIは安全な日本語だけを表示する。Household 0件とSELECT error、Child 0件とSELECT errorを分離する。Child詳細errorでは残高・履歴を空にしてfail closedとする。例外message、stack、SQL、tokenは公開stateへ入れない。

# Staging Acceptance

隔離fixtureでParent A → Household A → Child A/C、Parent B → Household B → Child Bのみを確認する。cross-household選択は拒否する。実stagingではParent A/Bの認証データとRLSが必要であり、local testはfixture受入、canonical stagingは実データ受入の境界とする。

# P2 Prerequisites

P1完了後もCloud write、mapping変更、migration apply、initial import、v2 activation、Phase 3再開は無効のままとする。P2ではこのruntimeを再利用し、backup status、Local profile一覧、Local/Cloud比較、migration previewをread-onlyで追加する。Cloud selectorやAuth chainを別UIへ再実装しない。
