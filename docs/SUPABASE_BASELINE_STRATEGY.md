# Current state

- 調査日: 2026-10-01。
- Supabase CLI 2.118.0 は導入済みで、`supabase/config.toml` も存在する。
- `supabase/config.toml` はmigrationとpg-delta diff engineを有効化しており、DB major versionは17。seedは `supabase/seed.sql` を参照する設定である。
- Docker Desktop、Podman、Rancher DesktopなどのDocker API互換container runtimeは未導入で、local Supabase stackは未起動。
- remote projectは未link。この調査ではlogin、link、remote接続、remote SQL、push、repairを実行していない。
- 実行対象のmigrationは次の2本だけで、どちらもremoteには未適用と文書化されている。
  1. `202609290001_common_family_core.sql`
  2. `202609290002_migrate_children_to_household.sql`
- `supabase/archive/20260919_initial_hapichike_schema.sql.archived` は設計履歴専用である。実行可能なbaselineではなく、migration runnerの対象に戻してはいけない。
- localStorageは引き続き子ども側データのsource of truthであり、本作業ではキー、構造、同期方針を変更しない。

# Why clean db reset currently fails

`npx supabase db reset` は空のlocal DBにmigrationをファイル名順で適用する。しかし最初の `202609290001_common_family_core.sql` は初期schema作成migrationではなく、既存remote schemaに対する差分migrationである。

最初のmigrationのpreflightは、少なくとも次を要求する。

- `public.profiles` と `public.children` が既に存在する。
- `profiles.id` のFKが `auth.users(id) on delete cascade` と一致する。
- `profiles.display_name` がnullable textである。
- `profiles` に指定名のRLS policyが3本だけ存在する。
- `public.households` と `public.household_members` はまだ存在しない。

続く `202609290002_migrate_children_to_household.sql` も、空の `public.children`、`children.parent_id uuid`、指定名のFKと3本の既知policyなど、旧schemaの厳密な形を要求する。

したがってclean DBでは1本目の `public.profiles does not exist` で停止する。仮に `profiles` と `children` だけを推測で作っても、FK、列、policy、権限、trigger、functionなどがremote実物と一致しなければpreflightまたは後続検証に失敗する。現在の2本だけでは空DBからremote相当schemaを再現できない。

# Remote schema assumptions

現行文書には、remoteに `public.profiles` と旧 `parent_id` 方式の `public.children` があり、両方とも0件とある。ただしremote未linkのため、この作業では実DBに対して確認できていない。以下はすべて `UNKNOWN / 要確認` とする。

- remoteの完全なtable、column、constraint、index、sequence、function、trigger、grant、RLS policy
- `auth` / `storage` schemaへのユーザー定義customization
- `supabase_migrations.schema_migrations` の有無と記録済みversion
- `profiles` / `children` の実row数と、preflight条件への完全一致
- remote PostgreSQL major versionがlocal設定の17と一致するか

remoteを確認せずに `profiles` / `children` を手書きで作ることはしない。schemaとmigration historyは別物なので、`migration list` と `db pull` の両方で確認する。

# Recommended baseline strategy

推奨は **Aを管理された作業ブランチで行い、Cの空の別staging projectを最終リハーサル先として併用する** 方針である。schemaの出典は必ず既存remoteに対する `supabase db pull` とし、archiveや文書から推測してbaselineを手書きしない。

1. 既存remoteのmigration historyを `supabase migration list` で記録する。
2. 既存2 migrationを削除・編集せず安全に退避できる作業ブランチまたは作業コピーを作る。
3. 方針を承認した後、Docker Desktop、Rancher Desktop、PodmanなどのDocker API互換runtimeを導入・起動する。`db pull` はshadow DBを構築するため、実際のpullより前に必要である。
4. `db pull` がremoteの現状を「2本の差分適用後」と誤認しないよう、取得時だけ既存2本を `supabase/migrations/` の外へ退避し、remote schemaを単独のbaselineとしてpullする。退避前後でhashまたはGit diffを確認する。
5. `db pull` が「remote migration historyを更新するか」と質問した場合、この取得段階では **No** とする。まず生成SQLを検証し、remote履歴を変更しない。非対話実行は自動承認されるため、初回取得では使わない。
6. 生成されたbaselineについて、`profiles` / `children`、FK、policy、grant、function、trigger、extension、およびCLIが除外したmanaged schema customizationの有無を確認する。
7. baselineを既存2本より前に実行できるversionへ整理する。既存2本のファイル名・timestamp・SQL本文は変更しない。変更候補は `db pull` が新規生成したbaselineファイルのversion部分だけだが、実際のversionはremote migration historyを確認し、衝突しない値を選んでレビュー承認する。例を決め打ちしない。
8. 実行順を `baseline -> 202609290001 -> 202609290002` としたうえでclean local resetを検証する。
9. schema、RLS、RPC、権限のテストが通った後、空の別staging projectで同じ履歴を最初から適用する。productionや既存remoteをリハーサルに使わない。
10. 既存remoteへ適用する前に再度 `migration list` と `db push --dry-run` を確認し、予定外のbaseline再実行やversion不整合があれば停止する。

重要: baseline SQLがremote schemaと一致しても、そのversionがremote historyに未記録なら、`db push` はbaselineを未適用と判断して既存objectを再作成しようとする可能性がある。既存remoteへの最終導入には、検証済みbaselineを履歴上どう表現するかという別の承認が必要である。実schemaとの同一性を確認した後に限り、baseline versionをappliedとして記録することを検討できるが、この作業では行わない。

公式資料:

- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Local Development & CLI](https://supabase.com/docs/guides/local-development)
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-db-schema-declarative)

# Alternatives considered

| 案 | remote migration historyとの整合 | `db push`への影響 | clean `db reset`再現性 | 今後の運用しやすさ | 評価 |
|---|---|---|---|---|---|
| A. remote schemaをbaselineとして取得後、既存履歴を再構成 | `migration list` とbaselineの同一性確認が必須。検証後に限り履歴記録を合わせられる | 正しく整合すれば通常運用へ移行可能。未整合のままではbaselineの再実行やversion conflictの危険 | `baseline -> 001 -> 002` の順を確立すれば高い | 一度整理すれば標準的なmigration-only運用にできる | **推奨する中核案** |
| B. remote schemaをfixture / schema snapshotとして保持し、local testだけ先に読む | remote migration historyとは分離されたまま | fixtureは通常のmigration履歴に入らず、local成功が`db push`安全性を証明しない | 読込機構を固定すればlocalだけは再現可能だが、標準のmigration-only resetから逸脱 | 二重管理になり、snapshot更新漏れと環境差が生じやすい | 一時診断用。恒久策には非推奨 |
| C. 別staging projectでremote baseline + 2 migrationを再構築 | 元remoteの履歴を直接変えずに検証できるが、元remoteとの履歴対応は別途解決が必要 | 空stagingへのpush/replayを安全に試せる。元remoteへのpush可否は自動的には保証しない | 空projectでend-to-end再現性を検証できる | project費用・設定管理は増えるが、安全な昇格手順を作りやすい | **Aの検証先として推奨**。単独では履歴問題を解決しない |

Bを採る場合でもsnapshotは実行migrationと明確に分離し、production deploymentの根拠にしない。Cでは元remoteのdataを複製せず、必要なら匿名化したtest dataだけを別途用意する。

# Migration history risks

- Supabaseはlocalファイルとremoteの `supabase_migrations.schema_migrations` をversionで比較し、migrationをversion順に適用する。
- `db pull` が現在時刻のversionを付けると、`202609290001` / `202609290002` より後になる可能性が高い。そのままでは差分がbaselineより先に走り、clean resetは失敗する。
- 既存2本のtimestampを変更すると、将来remote historyとの対応やレビュー履歴を壊すため変更しない。
- 新規baselineのversionを前へ移す場合も、remoteに既存versionがないか確認し、生成SQLの内容を変えず、rename理由をレビュー記録に残す。
- remote historyが既に存在する場合、単一baselineへのsquashがその履歴を表現できるとは限らない。`migration list` の結果が得られるまで最終version構成は確定しない。
- `db pull` の生成物は無条件に正しいとはみなさない。managed schemaのcustomization、owner、grant、extension、RLS、security definer、search pathを確認する。
- `db pull` 後のremote履歴更新promptを承認するとremoteの履歴tableが変わる。この取得・検証段階ではNoとする。
- `supabase db reset --linked` はlinked remoteを破壊的にresetする。local検証では絶対に `--linked` を付けない。
- `supabase/seed.sql` はreset時に実行される設定である。schema検証時はseedの内容と副作用も確認し、必要に応じてlocalで `--no-seed` を使用する。remoteへ `--include-seed` しない。

# Remote link procedure

以下は将来ユーザーが実施する手順であり、今回の作業では実行しない。

1. 対象がproductionではなく、baseline取得元として承認されたstaging projectであることをDashboard上で確認する。
2. project ref、DB password、remote PostgreSQL versionを確認する。tokenやpasswordはGit管理ファイルへ書かない。
3. `supabase login`
4. `supabase link --project-ref <staging-project-ref>`
5. link先を再確認する。
6. `supabase migration list` を実行し、LOCAL / REMOTEの全versionを保存する。
7. remote schemaの目視確認として、少なくとも `profiles` / `children` の列、constraint、RLS、policy、row数が既存2 migrationのpreflightに合うか確認する。remote SQL editorで変更SQLは実行しない。

`link` はremote projectとの関連付けでありschema migrationではないが、以後のコマンドの対象を決める。project refの取り違えを防ぐため、各remote操作前に対象を再確認する。

# db pull procedure

1. Gitの未保存変更を把握し、専用作業ブランチまたは作業コピーを用意する。
2. Docker API互換runtimeを導入・起動する。公式workflowでは `db pull` がlocal migrationsからshadow DBを構築するため、runtimeなしではこの工程を開始しない。
3. `supabase/migrations/` の2本を変更せず、取得中だけ実行対象外の安全な場所へ退避する。archiveの旧SQLは使用しない。
4. 対話可能なterminalで `supabase db pull` を実行する。非対話実行はremote履歴更新を自動承認し得るため使わない。
5. remote migration historyの更新を促された場合は **No**。この段階ではremoteを変更しない。
6. 生成ファイルを別名保存する前に、取得日時、CLI version、project ref、対象schemaを記録する。
7. 生成SQLをレビューする。最低限、2本のpreflightが要求する `profiles` / `children` の完全な形、3本ずつの既知policy、FK名、grantを確認する。
8. pg-deltaが除外するmanaged objectを理解し、特に `auth` / `storage` 内に独自functionやindexがある場合は停止して、明示的なversioned migrationが既に存在するか確認する。推測で追記しない。
9. 既存2本を元の名前・内容のまま戻し、hashまたはGit diffで同一性を確認する。
10. `migration list` で得たremote履歴と衝突しない、かつ `202609290001` より前のbaseline version案をレビューする。生成baselineだけをrenameする場合も、この承認後に行う。
11. `baseline -> 202609290001 -> 202609290002` の並びをファイル一覧で確認する。

補足: `db pull` はschema取得の正規手段だが、data backupではない。row data、Auth user、Storage objectの移行を目的にしない。

# Local reset procedure

baseline方針を承認した後、かつ `db pull` より前に導入したDocker Desktop、Rancher Desktop、PodmanなどのDocker API互換runtimeをそのまま使用する。Supabase公式文書上、shadow DBを使うpullとlocal stackにはCLIに加えてcontainer runtimeが必要である。

1. runtimeが正常起動していることを確認する。
2. `npx supabase start`
3. link先に依存しないlocalコマンドであることを確認し、`npx supabase db reset` を実行する。**`--linked` は付けない。**
4. resetログでbaseline、`202609290001`、`202609290002` がこの順に成功したことを確認する。
5. seedがschema検証を妨げる場合は、理由を記録して `npx supabase db reset --no-seed` でも切り分ける。
6. local Studioまたはlocal接続で最終schemaを確認する。
7. resetをもう一度実行し、毎回同じ結果になることを確認する。
8. RLS / RPC testを実行する。
9. 空の別staging projectでリハーサルする前に `supabase migration list` と、適用対象側に対するdry-runを確認する。

# Validation checklist

- [ ] remote project refと環境名を二者または記録済み手順で確認した
- [ ] `supabase migration list` のLOCAL / REMOTE結果を保存した
- [ ] remote PostgreSQL major versionを確認し、`config.toml` の17と整合した
- [ ] baselineは `db pull` 生成物であり、手書きの推測schemaではない
- [ ] baseline取得時にremote migration historyを更新していない
- [ ] `profiles` の列、FK、policy、grantがmigration 001のpreflightに一致する
- [ ] `children` が空で、旧 `parent_id`、FK、policy、trigger/function/view依存がmigration 002のpreflightに一致する
- [ ] extension、function、trigger、index、constraint、grant、RLSをレビューした
- [ ] `auth` / `storage` のユーザー定義customizationの取得漏れがない
- [ ] baseline versionが既存2本より前で、local/remoteの既存versionと衝突しない
- [ ] 既存2 migrationの名前、timestamp、SQL本文を変更していない
- [ ] `npx supabase db reset` がclean local DBで連続して成功する
- [ ] household外のユーザーが行を閲覧・変更できない
- [ ] owner / parent / viewerの許可範囲が期待どおりである
- [ ] `anon` が保護tableとRPCへアクセスできない
- [ ] `create_household` とmember管理RPCの認証・role・owner invariantを確認した
- [ ] 失敗するRPCが部分更新を残さずrollbackされる
- [ ] schema diffが期待した最終schemaと一致する
- [ ] 別staging projectでbaseline + 2 migrationの再現を確認した
- [ ] remote適用前の `migration list` と `db push --dry-run` に予定外の差分がない

# Things not to do

- 今回は `supabase db push`、remote SQL、remote schema変更をしない。
- `supabase db reset --linked` を実行しない。
- `migration repair` を履歴合わせの近道として実行しない。
- remoteを確認せず `profiles` / `children` baselineを手書きしない。
- archive SQLをmigrationへ戻したり実行したりしない。
- 既存2 migrationの名前、timestamp、本文を勝手に変更しない。
- baselineを既存2本より後のtimestampのまま確定しない。
- `db pull` の生成物を未レビューでcommitまたはpushしない。
- `db pull` のremote履歴更新promptを取得直後に承認しない。
- migration listの不一致をschema一致の証拠とみなさない。
- localStorageのキー、構造、データを変更しない。
- `dist/` を直接編集しない。

`migration repair` はremote migration historyだけを書き換え、SQL自体を適用・取消ししない。使用条件は、対象versionのSQL効果とremote実schemaが一致することをobject単位で確認し、row/data前提も満たし、誤ったhistory recordだけが問題だと証明できた場合に限る。その場合も対象version、`applied` / `reverted` の向き、復旧手順、承認者を記録してから実行する。今回は禁止する。

# Next step

ユーザーが次に行うのは、承認済みの **staging project ref** とDB接続情報を用意し、次のread-first手順を実施することである。

1. `supabase login`
2. `supabase link --project-ref <staging-project-ref>`
3. `supabase migration list`
4. その出力と、remoteの `profiles` / `children` 定義・row数・PostgreSQL major versionを保存する

この結果をレビューするまでは、`db pull` 後の履歴更新、baseline version確定、`migration repair`、`db push` を行わない。確認結果に基づいてbaseline取得用の安全な作業ブランチを作る。container runtimeはbaseline方針を承認した後、実際の `db pull` より前に導入し、既存2本を一時退避したうえでpullへ進む。
