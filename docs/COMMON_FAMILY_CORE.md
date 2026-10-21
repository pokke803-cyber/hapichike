# Common family core

共通Supabase `pokke-family-apps`向けのfamily/auth基盤です。2026-09-29時点ではmigrationファイルを作成しただけで、remote DBへは未適用です。

## Migration order

1. `supabase/migrations/202609290001_common_family_core.sql`
2. `supabase/migrations/202609290002_migrate_children_to_household.sql`

旧ハピチケSQLは`supabase/archive/20260919_initial_hapichike_schema.sql.archived`に保存しています。`supabase/migrations/`の外かつ`.sql`以外の拡張子なので、migration runnerの対象ではありません。

## Shared tables

- `profiles`: Auth user本人の共通プロフィール。`display_name`のみ直接更新可能。
- `households`: 家庭。owner列は持たない。
- `household_members`: ユーザーの家庭所属と`owner` / `parent` / `viewer` role。
- `children`: 家庭に所属する子ども。旧`parent_id`は廃止し、`household_id`を使用する。

## Access model

- `anon`には共通テーブル、helper、RPCの権限を付与しない。
- `households`と`household_members`の直接操作はSELECTだけ。
- household/member変更はowner限定のSECURITY DEFINER RPCを使用する。
- member変更RPCはhousehold行を`FOR UPDATE`し、同じ家庭の並行変更を直列化する。
- deferred constraint triggerとRPC内検査の両方で、最後のownerの削除・降格を拒否する。
- `children`はmemberがSELECTでき、`owner` / `parent`だけがINSERTと`name` / `nickname`のUPDATEを行える。
- `children.household_id`の直接UPDATEと`children`の直接DELETEは許可しない。

## Safety

`migrate_children_to_household`はtransaction内で`children`件数を再確認し、0件以外ならDDL前に中断します。既存policy、FK、trigger、参照FKがpreflight想定と異なる場合も中断します。

適用前にはremote migration履歴、バックアップ、対象project refを改めて確認してください。旧archive SQLを実行してはいけません。
