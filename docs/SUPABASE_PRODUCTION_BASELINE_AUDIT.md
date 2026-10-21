# Production project confirmation

- 確認日: 2026-10-02（Asia/Tokyo）
- production project name: `pokke-family-apps`
- production project ref: `rrdokjeuwewphmlncguq`
- staging project name: `hapichike-staging`
- staging project ref: `dhmkpqrfaukfbuoaenhk`
- production ref と staging ref は一致していない。
- Supabase CLI の project 一覧で名称・ref・ACTIVE_HEALTHYを確認し、Dashboard の production project URLと Project Settings URL で同じ ref を確認した。Dashboard は Supabase 側の技術問題バナーを表示し、project データの一部が読み込まれない状態だった。

# Production migration history

`db pull` 前の production remote migration history は空だった。

```text
migrations: []
```

1回目の `db pull` は pooler 認証のタイムアウトで失敗し、ファイルも history も生成しなかった。失敗後の remote history が空であることを再確認した。

2回目の `db pull` は baseline file を生成したが、CLI 2.119.0 が確認プロンプトを表示せず、同時に次の migration history を production へ自動追加した。

```text
20261001191833 | 2026-10-01 19:18:33
```

CLI 出力は `remoteHistoryUpdated: true` と `Repaired migration history: [20261001191833] => applied` を返した。これは「production migration history を変更しない」という今回の安全条件に反する。

`migration repair`、remote SQL、その他の復旧操作は今回の禁止事項のため実行していない。

# db pull result

- 隔離作業ディレクトリ: `C:\Users\user\AppData\Local\Temp\hapichike-production-baseline-20261001`
- 隔離projectは `npx supabase init` で作成し、実行前の `supabase/migrations` は未作成（空）だった。
- 元リポジトリの2 migrationは隔離環境へコピーせず、編集・移動・改名もしていない。
- 1回目: 失敗。`FATAL: (EAUTHQUERY) auth_query secret check timed out (SQLSTATE XX000)`。
- 2回目: schema pullとbaseline file生成は成功。ただし remote history 更新を自動実行したため、安全条件を満たした完全成功とは扱わない。
- diff engine: `pg-delta`

# Generated baseline file

- filename: `20261001191833_remote_schema.sql`
- size: 5,857 bytes
- 保持場所: `C:\Users\user\AppData\Local\Temp\hapichike-production-baseline-20261001\supabase\migrations\20261001191833_remote_schema.sql`
- 元リポジトリの `supabase/migrations/` にはまだ入れていない。
- filename/timestamp はまだ変更していない。
- ファイルには `CREATE EXTENSION`、`CREATE TYPE`、`CREATE SEQUENCE`、standalone `CREATE INDEX` は含まれない。PKに伴うindexはPostgreSQLが暗黙に作成する。

# profiles schema

`public.profiles`:

- `id uuid NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `display_name text NULL`
- primary key: `profiles_pkey (id)`
- foreign key: `profiles_id_fkey`, `id -> auth.users(id) ON DELETE CASCADE`
- unique constraint: PK以外なし
- RLS enabled

# children schema

`public.children`:

- `id uuid NOT NULL DEFAULT gen_random_uuid()`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `parent_id uuid NULL`
- `name text NULL`
- `nickname text NULL`
- `household_id`: なし
- primary key: `children_pkey (id)`
- foreign key: `children_parent_id_fkey`, `parent_id -> public.profiles(id) ON DELETE CASCADE`
- unique constraint: PK以外なし
- RLS enabled

# FK / constraints

- `profiles.id` は `auth.users.id` を参照し、auth user削除時にprofileもcascade削除される。
- `children.parent_id` は `profiles.id` を参照し、profile削除時にchildrenもcascade削除される。
- `parent_id`、`name`、`nickname` はbaseline時点でnullable。
- CHECK constraint、PK以外のUNIQUE constraint、standalone indexはbaselineにない。

# RLS / policies

`profiles` に次の3 policyがある。すべて `authenticated` 向けで、`auth.uid() = id` を使う。

- `Users can view own profile` / SELECT
- `Users can insert own profile` / INSERT
- `Users can update own profile` / UPDATE

`children` に次の3 policyがある。すべて `authenticated` 向けで、`auth.uid() = parent_id` を使う。

- `Users can view own children` / SELECT
- `Users can insert own children` / INSERT
- `Users can update own children` / UPDATE

DELETE policyはどちらのtableにもない。

# Functions / triggers

- function: `public.rls_auto_enable()`
  - `event_trigger` 用のPL/pgSQL関数
  - `SECURITY DEFINER`
  - `search_path = pg_catalog`
  - `public` schemaの `CREATE TABLE`、`CREATE TABLE AS`、`SELECT INTO` に対してRLSを自動有効化する。
- event trigger: `ensure_rls`
  - event: `ddl_command_end`
  - 上記3種のDDL tagで `public.rls_auto_enable()` を実行する。
- `profiles`、`children`に直接設定されたユーザーtriggerはbaselineにない。

# Grants

- `anon`、`authenticated` に `profiles` と `children` の DELETE/INSERT/MAINTAIN/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE がgrantされている。実データへの制限はRLS policyに依存する。
- `service_role` と `postgres` にも両tableの広い権限がgrantされている。
- default privilegesは `anon`、`authenticated`、`service_role` に対し、sequence/function/tableの既存default grantを一度revokeしたうえで、tableの MAINTAIN/REFERENCES/TRIGGER/TRUNCATE をgrantする。
- `public.rls_auto_enable()` は `PUBLIC` にEXECUTEがgrantされる。`anon`、`authenticated`、`service_role` への直接grantはrevokeされるが、`PUBLIC` grantの効果は別途査読対象とする。

# Differences from local assumptions

baselineは既存migrationの主要な前提と一致する。

- `profiles` と `children` が存在する。
- `profiles_id_fkey` は `auth.users(id) ON DELETE CASCADE`。
- `profiles.display_name` はnullable text。
- `profiles` の旧3 policy名が正確に一致する。
- `children.parent_id` はuuidで、`household_id` はまだない。
- `children_parent_id_fkey` は `profiles(id) ON DELETE CASCADE`。
- `children` の旧3 policy名が正確に一致する。
- `households`、`household_members`、`is_household_member(uuid)`、`has_household_role(uuid,text[])` はbaselineにない。

差分・要確認:

- productionには既存2 migrationが明示的に前提としていない `rls_auto_enable()` と `ensure_rls` event triggerがある。ただし、新tableのRLSを自動有効化する動作はmigration内の明示的 `ENABLE ROW LEVEL SECURITY` と矛盾しない。
- baselineのtable grantは広いが、migration 1と2はこれをrevokeし、column/table単位の狭いgrantへ変更する設計。
- migration 2は `public.children` が0件であることをpreflightで要求する。今回許可されたremote操作はschema readの `db pull` だけのため、データ件数は再確認していない。現時点では `UNKNOWN（以前の記録では0件）`。
- migration 1の「auth userごとにprofileがある」preflightもschema pullだけでは再確認できない。`UNKNOWN`。

# Timestamp ordering problem

生成version `20261001191833` は既存version `202609290001`、`202609290002` より後である。そのまま追加すると、clean DBで差分migrationがbaselineより先に実行されるため不正。

またproduction historyに自動追加された `20261001191833` と、将来整理するbaseline versionは一致しなくなる。productionをmigration適用先としない場合でも、意図しないhistory行は別作業で是正方針を決める必要がある。

# Proposed baseline placement

査読とproduction historyの是正方針確定後、baseline fileだけを次のversionへ整理する案とする。今回はrename・移動しない。

```text
202609290000_production_baseline.sql
202609290001_common_family_core.sql
202609290002_migrate_children_to_household.sql
```

`202609290000` は既存2本の直前で、重複しない。改名後にはSQL内容を変えず、まずclean local replayを実行しない。

# Production mutation check

- application schema: `db pull` による変更なし。
- application data: INSERT/UPDATE/DELETE、function実行、remote SQLを実行していない。
- migration metadata: **変更あり**。CLIが `supabase_migrations.schema_migrations` に `20261001191833` をappliedとして自動記録した。
- `db push`、`db reset --linked`、`migration repair`、remote SQLは実行していない。
- productionは隔離環境からunlink済み。

# Staging mutation check

- 元リポジトリのlink先は `hapichike-staging` / `dhmkpqrfaukfbuoaenhk` のまま。
- staging remote migration historyは空。
- local migration listは `202609290001`、`202609290002`。
- stagingへの `db push`、SQL変更、repairは実行していない。

# Next step

local baseline再現テストへはまだ進まない。先に、production migration historyに自動追加された `20261001191833` の扱いを別作業で決める。

元の空historyへ戻す場合、Supabaseの標準手段は対象versionの `migration repair --status reverted` だが、これは今回の絶対禁止操作であるため未実行。明示的な是正依頼、実行前後のhistory確認、対象versionの固定を伴う独立した安全手順が必要。

是正後の推奨順序:

1. production remote historyが再び空であることを確認する。
2. baselineを隔離状態で最終査読する。
3. baselineだけを `202609290000_production_baseline.sql` として元リポジトリへ配置する。
4. clean local DBで `baseline -> 202609290001 -> 202609290002` の順に再現テストする。
5. local replay成功後に限り、同じchainを空のstagingへ適用する。productionには適用しない。
