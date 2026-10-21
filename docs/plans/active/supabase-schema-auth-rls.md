# Task
Supabase schema / Auth / RLS foundation

## Goal
親のSupabase Authユーザーを家庭メンバーとして認可し、家庭・子ども単位のデータを実テーブルへ安全に保存できるSQL migrationと未接続APIを用意する。既存UIとlocalStorageを現在のまま維持する。

## Scope
- PostgreSQLテーブル、制約、索引、更新日時トリガー
- 全家庭データテーブルのRLSと家庭所属ポリシー
- 家庭作成、残高更新、5スター交換、PAY調整、掲示板報酬承認のRPC
- 親向けSupabase Authおよび家庭コンテキスト用API
- 現行仕様・移行前提・未実装範囲の文書化

## Files to inspect
- `docs/CURRENT_STATE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/API.md`
- `docs/SYNC_STRATEGY.md`
- `docs/STORAGE.md`
- `docs/DATA_STRUCTURE.md`
- `docs/KNOWN_ISSUES.md`
- `docs/PARENT_CONTROLS.md`
- `docs/REWARD_SYSTEM.md`
- `src/lib/supabaseClient.js`
- `src/services/api/*.js`
- `package.json`

## Files allowed to modify
- `supabase/archive/20260919_initial_hapichike_schema.sql.archived`（旧設計・実行禁止）
- `src/services/api/*.js`
- 上記の関連`docs/*.md`
- このplan

## Files not to modify
- `index.html`
- `homecasino.html.txt`
- `dist/`
- `public/`
- 既存localStorage内容、キー、読込・保存処理
- `.env`およびremote Supabase project

## Current behavior
アプリは`kidsVegasCasino.v1`と`kidsVegasCasino.parentEmail.v1`だけを実データ源として使う。SupabaseクライアントとAPI雛形は存在するがUIから呼ばれず、認証、migration、RLS、同期は未実装。子ども名は単一の表示ラベルで、子ども別IDやデータ分離はない。

## Desired behavior
SQL適用後は、認証済み親が所属する家庭の行だけをanon key経由で操作できる。子ども別残高と今後のタスク・掲示板・履歴を保存でき、重要な残高変更はDB内で原子的に完了する。未設定時と現行UIの挙動は変えない。

## Database schema
- `households`
- `household_members`（`owner` / `parent`、家庭・ユーザー複合unique）
- `children`
- `child_balances`
- `tasks`
- `today_tasks`
- `help_jobs`
- `help_job_applicants`
- `reward_logs`
- `parent_settings`

UUID主キー、FK、非負残高CHECK、status/reward type CHECK、二重応募unique、検索用indexを設定する。`parent_settings`に認証パスワード列は作らない。

## RLS strategy
全テーブルでRLSを有効化する。`auth.uid()`と`household_members`を照合する`SECURITY DEFINER`ヘルパーを用い、ポリシー内の自己参照再帰を避ける。直接`household_id`を持たない表は`children`または`help_jobs`を経由して家庭所属を検証する。家庭削除とメンバー管理はownerに限定する。

## RPC strategy
- `create_household`: householdとowner membershipを同一トランザクションで作成
- `add_ticket`: チケット加算とログ記録
- `add_star_coin`: スター加算とログ記録
- `exchange_star_coins_for_ticket`: 行ロック、5スター減算、1チケット加算、ログ記録
- `adjust_pay_balance`: 指定PAYの符号付き調整とログ記録、負残高拒否
- `complete_today_task`: 行ロック、未付与確認、task報酬加算、完了・付与済み化、ログ記録
- `approve_help_job_reward`: 応募行ロック、未付与確認、残高加算、承認状態更新、ログ記録

全RPCは認証済み家庭所属をDB内で再確認し、`authenticated`だけに実行権限を付与する。

## Implementation plan
1. migrationへschema、制約、索引、トリガー、認可ヘルパーを作成する。
2. テーブルごとのRLS policyとRPC権限を作成する。
3. API雛形を実テーブル名・RPC引数・Auth/家庭コンテキストへ合わせる。
4. 関連文書を実装済み状態と未実装範囲に更新する。
5. SQL静的確認、API import/build、既存UI非変更、git差分を確認する。

## Verification
- `npm run build`
- SQLのテーブル/RLS/policy/RPC定義を静的検索
- `index.html`、`homecasino.html.txt`、`dist/`を今回変更していないことをgit差分で確認
- service role key、自動sync、自動migration、localStorage変更がないことを検索

## Result
旧`20260919_initial_hapichike_schema.sql`へ10テーブル、全テーブルRLS、15 policy、家庭作成と6報酬系RPC、整合性/updated_at trigger、最小権限設定を実装した。このSQLは後に共通基盤との競合が判明し、`supabase/archive/20260919_initial_hapichike_schema.sql.archived`へ退避したため実行禁止。残高・reward log・報酬付与flagの直接変更を禁止し、owner role整合性と5スター交換の明示的な行lockを追加した。親Auth・household・実RPCに対応するAPIを追加/更新し、関連文書を現状へ更新した。`npm run build`と全API JavaScriptの`node --check`は成功した。ローカルにPostgreSQL/Supabase CLI実行環境がないため、migrationの実DB適用とRLSの複数ユーザー統合テストは未実施。remote適用、自動同期、localStorage移行、既存UI/保存ロジック変更は行っていない。
