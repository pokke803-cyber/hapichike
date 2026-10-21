# Supabase staging test

確認日: 2026-10-08

## Environment

- project name: `hapichike-staging`
- project ref: `dhmkpqrfaukfbuoaenhk`
- region: `ap-southeast-1`
- status: `ACTIVE_HEALTHY`
- CLI link: staging は `linked: true`、production (`rrdokjeuwewphmlncguq`) は `linked: false`

## Migration push

- push前のremote migration historyは空だった。
- `npx supabase db push --dry-run` は、対象が次の4本だけであることを表示して成功した。seedとroleの適用予定はなかった。
  - `202609290000_production_baseline.sql`
  - `202609290001_common_family_core.sql`
  - `202609290002_migrate_children_to_household.sql`
  - `202609290003_harden_event_trigger_permissions.sql`
- `npx supabase db push` は上記4本を順番に適用して成功した。

## Migration history

push後の`npx supabase migration list`で、次の4 versionがLocal / Remoteで一致した。

- `202609290000`
- `202609290001`
- `202609290002`
- `202609290003`

## Schema

staging実DBのcatalogを読み取り確認した。

- `profiles`: `id uuid NOT NULL`、`created_at timestamptz NOT NULL`、`display_name text NULL`
- `households`: 存在
- `household_members`: 存在
- `children`: `id uuid NOT NULL`、`created_at timestamptz NOT NULL`、`name text NOT NULL`、`nickname text NULL`、`household_id uuid NOT NULL`
- `children.parent_id`: 存在しない

## RLS

staging実DBの`pg_class.relrowsecurity`で、次の4テーブルがすべてRLS有効だった。

- `profiles`
- `households`
- `household_members`
- `children`

## Policies

staging実DBの`pg_policies`で合計8件を確認した。すべて対象roleは`authenticated`だった。

- `profiles`: `profiles_select_self`、`profiles_insert_self`、`profiles_update_self`
- `households`: `households_select_members`
- `household_members`: `household_members_select_members`
- `children`: `children_select_household_members`、`children_insert_household_parents`、`children_update_household_parents`

## Functions

public schemaのSECURITY DEFINER関数を実DB catalogで確認した。

- family coreの関数は`search_path=""`、`row_security=off`を固定している。
- `rls_auto_enable()`は`search_path=pg_catalog`を固定している。
- trigger functionの`ensure_new_household_has_owner()`、`prevent_last_household_owner_loss()`、`rls_auto_enable()`は`authenticated`から直接実行できない。
- 公開RPCとRLS helperに限り`authenticated`へEXECUTEが付与されている。

## Grants

- public schemaの確認対象関数はすべて`PUBLIC EXECUTE=false`、`anon EXECUTE=false`、`service_role EXECUTE=false`だった。
- `authenticated EXECUTE=true`: `create_household`、`add_household_member`、`set_household_member_role`、`remove_household_member`、`transfer_household_ownership`、`is_household_member`、`has_household_role`
- `authenticated EXECUTE=false`: `ensure_new_household_has_owner`、`prevent_last_household_owner_loss`、`rls_auto_enable`

## Event trigger

- `ensure_rls`は存在する。
- 実行functionは`public.rls_auto_enable()`。
- `pg_event_trigger.evtenabled = 'O'`で、通常origin sessionに対して有効。
- stagingへテストテーブルは作成していない。

## Auth status

Supabase Dashboardのstaging projectで読み取り確認した。設定変更とユーザー作成は行っていない。

- Email provider: ENABLED
- Confirm email: ON
- User signup: ON
- Site URL: `http://localhost:3000`
- Redirect URLs: 未設定

## Issues

- stagingのAuth URL設定がlocalhostのままで、Redirect URLも未設定。実際のstaging親画面URLが決まり次第、Parent A/B実アカウント試験前に設定値を確認する必要がある。今回は指示どおり変更していない。

## Migration file hashes

push前後でSHA-256が一致した。

- `202609290000_production_baseline.sql`: `A567CC08D377D752E03E55C43A337020C18377AA0B8E52C080DC8FDF4CCB1175`
- `202609290001_common_family_core.sql`: `3253EDE710B0192712647C560FD82791A5644554018E9B94F829E03D2F2ECEDD`
- `202609290002_migrate_children_to_household.sql`: `8356F9A7A59DEB6BB915E7C9AA07B970C0BE8D081A10412868DF4A46B9BA3FF6`
- `202609290003_harden_event_trigger_permissions.sql`: `6340BFF5C62F9E63BF6D6093509225988340C42492FAB1E85113C6AD9034F74A`

## Result

- stagingへのschema配置とDB catalog検証はPASS。
- productionへのlink、push、SQL、pull、repairは実行していない。
- Parent A/B実アカウント試験は、staging用Site URL / Redirect URLの確認・設定後に進める状態。
