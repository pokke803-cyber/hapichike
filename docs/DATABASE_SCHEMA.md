# Supabase database schema

共通family coreの適用候補は次の2 migrationです。いずれもremote Supabaseへは未適用です。

- `supabase/migrations/202609290001_common_family_core.sql`
- `supabase/migrations/202609290002_migrate_children_to_household.sql`

旧`20260919_initial_hapichike_schema.sql`は共通テーブルとハピチケ固有テーブルを混在させていたため、`supabase/archive/20260919_initial_hapichike_schema.sql.archived`へ退避しました。これは履歴参照専用で、実行してはいけません。共通基盤の詳細は`COMMON_FAMILY_CORE.md`を参照してください。

以下のハピチケ固有schema案は旧SQLの設計記録であり、`hapichike_*`への再設計前です。

## Tables

| Table | Purpose | Household boundary |
|---|---|---|
| `households` | 家庭 | `id`自身。`owner_user_id`は初期ownerで、複数家庭所有を妨げないためuniqueではない |
| `household_members` | 複数親の所属と`owner` / `parent` role | `household_id` |
| `children` | 子どもプロフィール | `household_id` |
| `child_balances` | 子ども別チケット、スター、3 PAY、カード残高 | `children.household_id`経由 |
| `tasks` | 再利用するお手伝い候補 | `household_id` |
| `today_tasks` | 子どもへ割り当てた項目 | `children.household_id`経由 |
| `help_jobs` | 将来のお手伝い掲示板 | `household_id` |
| `help_job_applicants` | 応募・完了・承認 | `help_jobs.household_id`経由。子どもと求人の家庭一致もtriggerで検証 |
| `reward_logs` | 報酬、交換、PAY変更等の監査履歴 | `household_id`。任意の`child_id`は同じ家庭に限定 |
| `parent_settings` | メールと音設定 | `household_id` |

`children`作成時は0残高の`child_balances`をtriggerで自動作成する。更新日時を持つ表はtriggerで`updated_at`を更新する。

## Integrity

- 残高はすべて整数かつ0以上。
- `reward_type`は`ticket`または`starCoin`。該当報酬は1以上。
- 選択されていない側の報酬額は0。ticket報酬とstar coin報酬の同時設定は拒否する。
- `today_tasks.status`は`pending` / `completed` / `cancelled`。
- `help_jobs.status`は`open` / `full` / `expired` / `closed` / `completed` / `cancelled`。
- `help_job_applicants`は`(job_id, child_id)` uniqueで二重応募を拒否する。
- `reward_granted = true`の応募は`approved`状態に限定する。
- 完了・承認状態には対応する`completed_at` / `approved_at`が必要。today taskの`reward_granted = true`は`completed`状態に限定する。
- `today_tasks`のtaskとchild、応募のjobとchild、履歴のhouseholdとchildは同一家庭でなければならない。
- member、child、task、help job、reward log、parent settingsの`household_id`は作成後変更不可。別家庭へ移す場合は明示的な将来手順が必要。
- `parent_settings`にパスワード列はない。Supabase Authのpasswordも既存localStorageの簡易パスワードもDBへ保存しない。

## RLS

全10テーブルでRLSを有効化する。認証済みユーザーの`auth.uid()`が`household_members`に存在する家庭だけを対象にする。`SECURITY DEFINER`のbooleanヘルパーでmembershipを確認し、`household_members`自身のpolicyによる無限再帰を避ける。

- 家庭内データ: memberはRLSの家庭境界内だけを操作可能。残高はSELECTのみ、reward logはSELECTのみで、変更は認証済みRPC内部に限定する。
- `today_tasks.reward_granted`と`help_job_applicants.reward_granted`はクライアントからINSERT / UPDATEできない。応募行は履歴を消して再応募・再付与できないようDELETE不可。
- household削除とmember管理: ownerのみ。
- household作成: RPC `create_household`で家庭とowner membershipを同一トランザクション作成。
- owner roleは`households.owner_user_id`本人の行だけに許可し、owner member行の直接削除を禁止する。一般parentは自身をownerへ昇格できない。
- householdの`owner_user_id`は作成後変更不可。
- `anon`にはテーブル/RPC権限を付与せず、RPCは`authenticated`だけ実行可能。

RLSは「ログイン済みなら全家庭可」ではなく、必ず対象家庭への所属を確認する。ブラウザ側IDは認可根拠にしない。

## Atomic RPCs

| RPC | Transactional work |
|---|---|
| `create_household` | household + owner member作成 |
| `add_ticket` | チケット加算 + reward log |
| `add_star_coin` | スター加算 + reward log |
| `exchange_star_coins_for_ticket` | 残高行を`FOR UPDATE`、5スター以上を条件に5減算 + チケット1加算 + log |
| `adjust_pay_balance` | 指定PAYを増減（負残高拒否）+ log |
| `complete_today_task` | today task行lock、未付与確認、task報酬加算、完了・付与済み化、log |
| `approve_help_job_reward` | 応募行lock、未付与・完了確認、残高加算、承認・付与済み化、log |

PostgreSQL function呼出しは1トランザクションであり、例外時は全変更がrollbackされる。today task完了と掲示板承認は対象行を`FOR UPDATE`し、`reward_granted`を確認して再実行時の二重付与を防ぐ。

## Local data mapping caveat

現在のlocal stateには単一`childName`しかなく、残高・タスク・履歴は共有である。複数`children`へ自動的に割り当てられない。移行前にJSONバックアップ機能を完成させ、親が対象childと変換内容を明示確認する必要がある。
