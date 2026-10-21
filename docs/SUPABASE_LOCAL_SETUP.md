# Container runtime

- Windows では Docker Desktop を第一候補とする。
- 2026-10-01 に Docker Desktop 4.93.0 を公式配布元からユーザー単位でインストールした。インストーラーの Authenticode 署名は `Valid`、署名者は Docker Inc であることを確認済み。
- Docker CLI は `Docker version 29.8.1, build 4a63305` を確認済み。
- Windows の `VirtualMachinePlatform` と WSL を管理者権限で有効化し、再起動済み。
- 2026-10-01 の再起動後、Docker Desktop Linux engine が `running` になることを確認済み。
- Docker Desktop を利用できない場合の代替候補は Rancher Desktop、次いで Podman とする。代替への切り替えは Docker Desktop の再起動後検証が失敗した場合だけ検討する。

# Docker verification

再起動後に次を実行する。

```powershell
docker --version
docker info
docker desktop status
```

完了条件:

- `docker --version` がバージョンを返す。
- `docker info` が Client だけでなく Server 情報も返す。
- `docker desktop status` が `running` を返す。

2026-10-01 の最終確認:

- `docker --version`: `Docker version 29.8.1, build 4a63305`
- `docker desktop status`: `running`
- `docker info`: Client/Server とも成功。Server 29.8.1、Linux/WSL2、16 CPUs、15.46 GiB memory。

# Local Supabase start

Docker の上記3条件が成功した後に、リポジトリルートで実行する。remote link が存在していても、`supabase start` は local stack を起動する操作である。

```powershell
npx supabase start
```

初回は Docker image の取得に時間がかかる。次が起動することを確認する。

- local Postgres
- Auth
- API
- Studio

`npx supabase db reset` は baseline 整理完了前に実行しない。

2026-10-01 の実行結果:

- 必要な Supabase 公式 Docker image の取得は成功した。
- local Postgres の初期化と migration 適用開始まで CLI は正常に動作した。
- `202609290001_common_family_core.sql` の preflight が `public.profiles does not exist` で意図どおり停止した。現在2本のみでは clean DB を再現できないため、local stack 全サービスの起動完了には production baseline が必要。
- 失敗後、CLI はコンテナーを自動停止した。`db reset` は実行していない。

# Local Supabase status

```powershell
npx supabase status
```

- Postgres、Auth、API、Studio の状態と local URL を確認する。
- Studio URL は確認記録してよい。
- anon key、service role key、JWT secret、DB password などは Git、ドキュメント、チャットに保存しない。

2026-10-01 の確認結果: DB コンテナーが停止済みのため、`npx supabase status` は `No such container: supabase_db_home_casino_APP` を返した。Studio URL を含む local endpoints はまだ利用できない。

# Current staging link

- staging project ref: `dhmkpqrfaukfbuoaenhk`
- `supabase/.temp/project-ref` で上記 ref への link を確認済み。
- local stack 確認後に次を実行し、再確認する。

```powershell
Get-Content supabase/.temp/project-ref
npx supabase migration list
```

期待値:

```text
Local:
202609290001
202609290002

Remote:
空
```

project ref が `dhmkpqrfaukfbuoaenhk` でない、または Remote が空でない場合は停止する。

2026-10-01 の実測:

```text
Project: hapichike-staging
Project ref: dhmkpqrfaukfbuoaenhk
Local  202609290001 | Remote 空
Local  202609290002 | Remote 空
```

# Production baseline safety procedure

`db pull` の目的は production の実 schema を local migration file として取得すること。ただし Supabase CLI は、`db pull` 後に remote migration history を更新するか確認する場合がある。production を未変更に保つため、その確認には必ず `n` と答える。非対話実行は自動承認になる可能性があるため禁止する。

1. 作業開始前に `supabase/.temp/project-ref` の staging ref `dhmkpqrfaukfbuoaenhk` を記録する。
2. production project ref をユーザーから明示的に受け取り、文字列を復唱確認する。推測しない。
3. Supabase Dashboard で対象が production であること、project ref が一致することを確認する。
4. 現在の `git status --short` と `supabase/migrations` 一覧を記録する。既存2 migration の内容、配置、filename は変更しない。
5. 現在2 migration は clean shadow DB に適用できないため、このリポジトリ直下で `db pull` しない。リポジトリ外に一時作業ディレクトリを作り、空の `supabase/migrations` を持つ隔離環境で baseline を取得する。
6. 隔離環境の `supabase/config.toml` は現在の設定を基にするが、migration file はコピーしない。一時ディレクトリの絶対パスと空の migration 一覧を実行前に確認する。
7. 隔離環境で `npx supabase link --project-ref <PRODUCTION_REF>` を実行し、production へ一時 link する。元リポジトリの staging link は書き換えない。
8. 隔離環境の `supabase/.temp/project-ref` と Dashboard の両方で production ref を再確認する。不一致なら停止する。
9. 隔離環境で `npx supabase migration list` を実行し、出力をローカルにのみ記録する。想定外の remote history があれば停止する。
10. production DB password はプロンプトでのみ入力し、コマンド引数、シェル履歴、ドキュメントに残さない。
11. 必ず人が対話プロンプトを監視する状態で、隔離環境から `npx supabase db pull production_baseline` だけを実行する。CI、リダイレクト、自動応答は使わない。
12. `Update remote migration history table? [Y/n]` が出た場合は必ず `n` と答える。`Y`、Enter、自動承認は production の `supabase_migrations.schema_migrations` を変更し得るため禁止。
13. 生成された `<timestamp>_production_baseline.sql` が隔離環境の local file のみであることを確認する。
14. baseline の `profiles`、`children`、FK、RLS、policy、functions、triggers、grants、extensions、sequences、enums/types を査読する。
15. 査読中は baseline を元リポジトリの `supabase/migrations` に混ぜず、filename/timestamp も変更しない。
16. 隔離環境で `npx supabase unlink` を実行し、production link を直ちに解除する。
17. 元リポジトリの `supabase/.temp/project-ref` が staging `dhmkpqrfaukfbuoaenhk` のままであることを確認する。必要な場合だけ `npx supabase link --project-ref dhmkpqrfaukfbuoaenhk` で復旧する。
18. 元リポジトリで `npx supabase migration list` を実行し、staging ref と Remote 空を再確認する。
19. production の migration history が取得前と同じことを読み取りで確認し、production 未変更の記録とする。

# Commands allowed

今回許可:

```powershell
docker --version
docker info
docker desktop status
npx supabase start
npx supabase status
npx supabase migration list
Get-Content supabase/.temp/project-ref
```

production baseline 取得の次工程で、明示的な最終確認後に許可する候補:

```powershell
npx supabase link --project-ref <PRODUCTION_REF>
npx supabase migration list
npx supabase db pull production_baseline
npx supabase unlink
npx supabase link --project-ref dhmkpqrfaukfbuoaenhk
```

# Commands prohibited

baseline の取得・整理・local clean replay 確認が終わるまで、次を実行しない。

- `npx supabase db reset`
- `npx supabase db reset --linked`
- `npx supabase db push`
- staging または production に対するすべての `db push`
- `npx supabase migration repair ...`
- remote SQL の実行・変更
- production `db pull`（次工程で別途明示承認するまで）
- migration filename/timestamp の変更
- localStorage 変更
- sync 実装
- `db pull` の remote migration history 更新プロンプトへの `Y` または Enter
- production を link したままの `db reset`、`db push`、`migration repair`、`db query`

# Baseline timestamp issue

- 現存 migration は `202609290001_common_family_core.sql` と `202609290002_migrate_children_to_household.sql`。
- `db pull` は取得時刻の timestamp で baseline を生成するため、そのままでは「差分 migration 2本 → baseline」の不正な順序になる。
- 取得直後はファイルを変更せず査読し、baseline が production schema の完全な開始点として使えるか確認する。
- 査読完了後、別作業として、生成 baseline だけを `202609290001` より前のユニークな timestamp へ改名する。例: `202609280000_production_baseline.sql`。
- 改名値は実際の生成ファイルと remote history を確認してから確定する。現時点では改名しない。
- 最終 migration chain は次の順序にする。

```text
production baseline
202609290001_common_family_core.sql
202609290002_migrate_children_to_household.sql
```

# Next step

1. production project ref を明示確認し、本書の `Production baseline safety procedure` に従って別工程で baseline を取得する。
2. `db pull` の remote migration history 更新プロンプトには必ず `n` と答え、production を未変更に保つ。
3. 取得した baseline を変更せず先に査読する。
4. baseline 整理後に初めて clean local DB で `baseline → 202609290001 → 202609290002` の replay を検証する。
5. replay 成功後に `npx supabase start` と `npx supabase status` で Postgres、Auth、API、Studio を確認する。
6. local replay 成功後に同じ chain を空の `hapichike-staging` へ適用する。production には適用しない。
