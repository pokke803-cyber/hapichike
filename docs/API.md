# Supabase API foundation

## Status

実テーブル/RLS/RPCに対応する将来用APIである。現行UIからはimportされず、localStorageとのupload、download、merge、同期、移行は一切行わない。Supabase未設定時も現行アプリはlocalStorage-onlyで動作する。

## Configuration

`.env.example`を`.env`へコピーし、次の公開クライアント設定だけを指定する。

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`service_role` keyや別のserver secretをブラウザへ置かない。未設定時、`src/lib/supabaseClient.js`は`null`を返し、未接続APIを明示エラーにする。

## Modules

| Module | API surface |
|---|---|
| `authApi` | 親のemail/password sign-up、sign-in、sign-out、session/user取得、auth state listener |
| `householdsApi` | 所属家庭・member取得、`getCurrentHouseholds(userId)`、`create_household` RPC、家庭名更新 |
| `childrenApi` | 子ども一覧・作成・更新。`getChildrenByHousehold(householdId)` は閲覧画面で使用 |
| `rewardsApi` | 残高取得、`add_ticket`、`add_star_coin`、5スター交換、PAY調整、ハピチャン調整RPC |
| `tasksApi` | task一覧・作成・更新・archive、today task一覧・作成・更新、原子的な完了報酬RPC |
| `historyApi` | child別/household別reward log取得。`getRecentRewardLogs(childId, limit)` で新着件数を制限。log作成は報酬RPC内部だけに限定 |
| `settingsApi` | parent settings取得/upsert。許可フィールドだけを送信 |
| `helpJobsApi` | 求人一覧・作成・応募・完了、`approve_help_job_reward` RPC |

残高変更と掲示板報酬承認はDB RPCを使用し、クライアント側read→updateは行わない。認可はRLSとRPC内のmembership検証が担い、client提供のhousehold IDだけを信頼しない。

## Auth boundary

Supabase Authアカウントを持つのは親だけ。子どもは`children` rowでありAuth userではない。現在のアプリ内`parentPassword`は同一端末の簡易ロックとして別に残り、Supabase Auth passwordへ変換・送信・保存しない。

## Parent read-only dashboard

`/parent` は `getParentSession` / `signInParent` / `signOutParent`、`getCurrentHouseholds`、`getChildrenByHousehold`、`getChildBalances`、`getRecentRewardLogs` だけを使う。データ取得は `household_members.user_id = auth user id` から始める。実際の認可境界は各tableの RLS であり、クライアント側フィルタだけに依存しない。閲覧画面から更新系API/RPCは呼ばない。

## Applying the database

共通family coreの適用候補は次の2ファイルで、remote DBへは未適用である。

- `supabase/migrations/202609290001_common_family_core.sql`
- `supabase/migrations/202609290002_migrate_children_to_household.sql`

旧ハピチケSQLは`supabase/archive/20260919_initial_hapichike_schema.sql.archived`に退避済みであり、実行してはいけない。ハピチケ固有table/RPCは`hapichike_*`再設計前のため、現在のmigrationには含まれない。リポジトリ内のbuildはDBへ自動適用しない。
