# Supabase migration適用・実DBテスト計画

> **停止中:** この文書の手順は、現在archiveにある旧一体型ハピチケSQLを前提としているため、そのまま実行してはいけません。共通family coreの2 migrationは作成済みですがremote未適用で、ハピチケ固有schemaは未再設計です。この文書は`hapichike_*` migration完成後に書き換えます。

旧対象（実行禁止）: `supabase/archive/20260919_initial_hapichike_schema.sql.archived`

以下は旧設計の履歴として残しています。Codexやアプリから自動適用・自動同期は行いません。

## 0. 判定基準と事前確認

- 対象project ref、環境名、リージョン、実行者、実行日時を記録する。
- migrationが未適用で、同名table / function / policyが存在しないことを確認する。これは初回用SQLであり、再実行用ではない。
- DashboardのDatabase > Backupsで利用可能な復元点と時刻を確認する。可能なら適用直前の論理backupも取得する。
- Authは親のemail/passwordだけを使用する。子どものAuth userは作成しない。
- Email confirmationを有効にするかは **要確認**。テスト中は、確認済みuserをDashboardから作成するか、実際の確認メールを完了させる。
- フロントに置けるのはproject URLとanon/publishable keyだけ。`service_role` key、DB password、親のpasswordをフロント、Git、テスト結果へ記録しない。
- session保存はSupabase client標準に任せ、独自password/session保存は追加しない。

### 適用前schema衝突チェック

SQL Editorで実行し、対象objectが0件であることを確認します。既に存在する場合は適用を止め、既存schemaとmigration historyを比較してください。

```sql
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by tablename;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'create_household', 'add_ticket', 'add_star_coin',
    'exchange_star_coins_for_ticket', 'adjust_pay_balance',
    'complete_today_task', 'approve_help_job_reward'
  )
order by routine_name;
```

### backup

Dashboard backup / PITRの復元点を記録したうえで、CLIを利用できる場合は次も保存します。schema dumpだけではデータbackupにならないため、既存データがあるprojectではdata dumpも取得します。

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db dump --linked --file .\backup-before-hapichike-schema.sql
supabase db dump --linked --data-only --file .\backup-before-hapichike-data.sql
```

backupファイルはsecretを含み得るためGitへ追加せず、安全な保管先へ移します。復元手順を実際に確認できないbackupは、唯一のrollback手段として扱わないでください。

## 1. migration適用

### 方法A: SQL Editor

1. Dashboardで対象project名とproject refを再確認する。
2. SQL Editorで新規queryを作り、migrationファイル全体を貼り付ける。
3. 先頭が`begin;`、末尾が`commit;`であることを確認する。
4. 一度だけRunする。途中でerrorになった場合はtransaction全体がrollbackされるため、原因を直す前にobject残存チェックを再実行する。
5. 成功後、「2. 適用直後の構造確認」を実行する。

### 方法B: Supabase CLI

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
supabase migration list
supabase db push --dry-run
supabase db push
supabase migration list
```

`--dry-run`の対象がこのmigrationだけであること、link先project refが正しいことを確認してからpushします。productionへ`--include-seed`や`supabase db reset --linked`を使用してはいけません。

### rollback上の注意

- この初回migrationにはtable、function、trigger、policy、index、grant、extension作成が含まれる。
- 実行中のerrorは外側transactionによりrollbackされるが、`commit`後に自動down migrationはない。
- 適用後にtableへデータを書いた状態でobjectをdropすると復元困難になる。問題時は書込みを止め、適用前backup / PITRからの復元、またはレビュー済みdown migrationを使う。
- `drop ... cascade`やremote `db reset`を即席のrollbackとして実行しない。

## 2. 適用直後の構造確認

### RLSとpolicy

次が10行すべて`rowsecurity = true`、policyは対象10 tableだけに存在することを確認します。

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by tablename;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by tablename, policyname;
```

### SECURITY DEFINERとsearch_path

`security_definer = true`の各functionで`config`に`search_path=""`が表示されることを確認します。空のsearch pathと完全修飾名を組み合わせ、呼出し元が作るobjectへの名前解決を防いでいます。

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_initial_child_balance', 'validate_today_task_household',
    'validate_help_job_applicant_household', 'validate_reward_log_child_household',
    'validate_household_member_role', 'is_household_member', 'is_household_owner',
    'create_household', 'add_ticket', 'add_star_coin',
    'exchange_star_coins_for_ticket', 'adjust_pay_balance',
    'complete_today_task', 'approve_help_job_reward'
  )
order by p.proname;
```

### constraint / index / privilege

```sql
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by table_name::text, conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by tablename, indexname;

select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'households', 'household_members', 'children', 'child_balances', 'tasks',
    'today_tasks', 'help_jobs', 'help_job_applicants', 'reward_logs', 'parent_settings'
  )
order by grantee, table_name, privilege_type;

select table_name, column_name, privilege_type
from information_schema.role_column_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in ('today_tasks', 'help_job_applicants')
order by table_name, privilege_type, column_name;
```

期待値:

- `anon`のtable privilegeは0件。
- `child_balances`と`reward_logs`は`authenticated`にSELECTだけ。
- `households`はINSERT不可。家庭作成は`create_household`だけ。
- `today_tasks.reward_granted`、`help_job_applicants.reward_granted / approved_at`はクライアントからINSERT / UPDATE不可。
- `help_job_applicants`はDELETE不可。
- FK、非負残高、capacity、status、reward type、家庭整合、二重応募uniqueが存在する。

## 3. Auth準備とテストデータ作成

Authentication > Usersで、実在しないテスト用emailを2件用意します。

| account | Auth user UUID | email確認済み | household UUID | child UUID |
|---|---|---|---|---|
| Parent A |  |  |  |  |
| Parent B |  |  |  |  |

以下の「認証user模擬」はSQL Editorの管理者接続でJWT claimとDB roleを一時設定し、実在するAuth UUIDとしてRLSを評価する手順です。毎回`begin`から`rollback`までを同じ実行単位で実行し、`auth.uid()`が想定UUIDであることを先に確認します。

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<PARENT_A_UUID>', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '<PARENT_A_UUID>', 'role', 'authenticated')::text,
  true
);
select auth.uid();
-- ここへParent AとしてのSQLを置く
rollback;
```

まずParent Aで次を実行し、返却されたhousehold UUIDを記録します。データを残す作成処理では末尾を`commit;`にします。

```sql
select id, name, owner_user_id
from public.create_household('RLS Test Household A');
```

Parent Bでも同様にHousehold Bを作成します。次に各userとして自家庭へchildを作成します。

```sql
insert into public.children (household_id, name)
values ('<HOUSEHOLD_A_UUID>', 'Child A')
returning id, household_id, name;
```

Child作成triggerで0残高が1行作られたことを各親として確認します。

```sql
select c.id, c.household_id, c.name, b.*
from public.children c
join public.child_balances b on b.child_id = c.id;
```

各家庭でtask、today task、help job、applicant、parent settingsも1件ずつ作り、`add_ticket`を1回呼んでreward logを作成します。A/BそれぞれのIDを記録します。applicantは同じ家庭のjobとchildを組み合わせてください。

| fixture | A UUID | B UUID |
|---|---|---|
| task |  |  |
| today task |  |  |
| help job |  |  |
| applicant |  |  |
| reward log |  |  |

## 4. 2家庭RLS分離テスト

各テストはParent A claimで実行し、その後A/Bを逆にして繰り返します。失敗を期待するINSERT/RPCは他の確認SQLと分けて実行します。error後は`rollback;`して新しいtransactionで次へ進みます。

### SELECT: 他家庭は0行

```sql
select * from public.households where id = '<HOUSEHOLD_B_UUID>';
select * from public.household_members where household_id = '<HOUSEHOLD_B_UUID>';
select * from public.children where household_id = '<HOUSEHOLD_B_UUID>';
select b.* from public.child_balances b where b.child_id = '<CHILD_B_UUID>';
select * from public.tasks where household_id = '<HOUSEHOLD_B_UUID>';
select tt.* from public.today_tasks tt where tt.child_id = '<CHILD_B_UUID>';
select * from public.help_jobs where household_id = '<HOUSEHOLD_B_UUID>';
select a.* from public.help_job_applicants a where a.child_id = '<CHILD_B_UUID>';
select * from public.reward_logs where household_id = '<HOUSEHOLD_B_UUID>';
select * from public.parent_settings where household_id = '<HOUSEHOLD_B_UUID>';
```

### INSERT: 他家庭へ作成不可

全10 tableについて、各statementがRLS violationまたは最小権限によるpermission deniedになることを確認します。失敗ごとにtransactionを終了してから次を実行してください。

```sql
-- households: RPC以外の直接作成は禁止
insert into public.households (name, owner_user_id)
values ('direct insert must fail', '<PARENT_A_UUID>');

insert into public.household_members (household_id, user_id, role)
values ('<HOUSEHOLD_B_UUID>', '<PARENT_A_UUID>', 'parent');

insert into public.children (household_id, name)
values ('<HOUSEHOLD_B_UUID>', 'cross-household child');

-- child_balances: trigger / RPC以外の直接作成は禁止
insert into public.child_balances (child_id) values ('<CHILD_B_UUID>');

insert into public.tasks (
  household_id, title, reward_type, ticket_reward, star_coin_reward
) values ('<HOUSEHOLD_B_UUID>', 'cross-household task', 'ticket', 1, 0);

insert into public.today_tasks (child_id, task_id)
values ('<CHILD_B_UUID>', '<TASK_B_UUID>');

insert into public.help_jobs (
  household_id, title, reward_type, ticket_reward, star_coin_reward
) values ('<HOUSEHOLD_B_UUID>', 'cross-household job', 'ticket', 1, 0);

insert into public.help_job_applicants (job_id, child_id)
values ('<JOB_B_UUID>', '<CHILD_A_UUID>');

-- reward_logs: RPC内部以外の直接作成は禁止
insert into public.reward_logs (household_id, child_id, type)
values ('<HOUSEHOLD_B_UUID>', '<CHILD_B_UUID>', 'must_fail');

insert into public.parent_settings (household_id, parent_email)
values ('<HOUSEHOLD_B_UUID>', 'invalid@example.test');
```

別途、自家庭Aのchildと他家庭Bのtask/jobを組み合わせた`today_tasks` / `help_job_applicants` INSERTも、RLSに加えて家庭一致triggerで拒否されることを確認します。

### UPDATE / DELETE: 他家庭は0行

```sql
update public.households set name = 'should not change'
where id = '<HOUSEHOLD_B_UUID>' returning id;

update public.household_members set role = 'parent'
where household_id = '<HOUSEHOLD_B_UUID>' returning id;

update public.children set name = 'should not change'
where id = '<CHILD_B_UUID>' returning id;

update public.tasks set title = 'should not change'
where household_id = '<HOUSEHOLD_B_UUID>' returning id;

update public.today_tasks set status = 'cancelled'
where id = '<TODAY_TASK_B_UUID>' returning id;

update public.help_jobs set title = 'should not change'
where id = '<JOB_B_UUID>' returning id;

update public.help_job_applicants set status = 'cancelled'
where id = '<APPLICANT_B_UUID>' returning id;

update public.parent_settings set audio_enabled = false
where household_id = '<HOUSEHOLD_B_UUID>' returning household_id;
```

0行であることと、Parent Bとして元データが変わっていないことを確認します。`child_balances` / `reward_logs`の直接UPDATEは自家庭・他家庭とも権限errorになるのが正しい結果です。

```sql
update public.child_balances set tickets = tickets + 1
where child_id = '<CHILD_B_UUID>';

update public.reward_logs set amount = 999
where id = '<REWARD_LOG_B_UUID>';
```

DELETEも全10 tableで確認します。Parent AからB行を指定した`households`、`household_members`、`children`、`tasks`、`today_tasks`、`help_jobs`、`parent_settings`のDELETEは0行です。`child_balances`、`help_job_applicants`、`reward_logs`は家庭を問わずpermission deniedです。各SQLに`returning`を付け、Parent B側でfixtureが残ることを再確認してください。

### household_members権限

1. Parent A ownerとしてHousehold AへParent Bを`parent` roleで追加する。
2. Parent Bとして自分のHousehold A member行を`owner`へUPDATEする。RLSで0行またはrole整合trigger errorとなり、昇格できないこと。
3. Parent BとしてHousehold Aへ別memberをINSERT / UPDATE / DELETEできないこと。
4. Parent Aでも、Parent Bのroleを`owner`にできないこと。
5. Parent Aのowner member行は直接DELETEできないこと。
6. Parent Bのparent member行はParent AだけがDELETEできること。
7. Household A自体のDELETEはParent Bでは0行、Parent Aでは可能であること。実データを残すテストではDELETEを実行せず、最後の専用test householdで確認する。

```sql
-- Parent A
insert into public.household_members (household_id, user_id, role)
values ('<HOUSEHOLD_A_UUID>', '<PARENT_B_UUID>', 'parent');

-- Parent B: 成功してはいけない
update public.household_members
set role = 'owner'
where household_id = '<HOUSEHOLD_A_UUID>' and user_id = '<PARENT_B_UUID>'
returning *;
```

## 5. RPCテスト

### 正常な加算と不正値

Parent Aとして実行します。

```sql
select * from public.add_ticket('<CHILD_A_UUID>', 2, 'RPC test');
select * from public.add_star_coin('<CHILD_A_UUID>', 5, 'RPC test');
```

`amount = 0`と負数はerror、ログ・残高とも変化なしであることを前後比較します。`adjust_pay_balance`だけは消費を表現する負数を仕様として許可しますが、結果が0未満になる調整はerrorで全rollbackされることを確認します。

```sql
select * from public.add_ticket('<CHILD_A_UUID>', 0, 'must fail');
select * from public.add_star_coin('<CHILD_A_UUID>', -1, 'must fail');
select * from public.adjust_pay_balance('<CHILD_A_UUID>', 'invalid', 1, 'must fail');
select * from public.adjust_pay_balance('<CHILD_A_UUID>', 'sweets', -1, 'insufficient must fail');
```

### 不正child_id / 家庭越境

Parent Aとして次がすべてaccess deniedになり、Child Bの残高・logが変化しないことをParent B側から確認します。

```sql
select * from public.add_ticket('<CHILD_B_UUID>', 1, 'must fail');
select * from public.add_star_coin('<CHILD_B_UUID>', 1, 'must fail');
select * from public.exchange_star_coins_for_ticket('<CHILD_B_UUID>');
select * from public.adjust_pay_balance('<CHILD_B_UUID>', 'toy', 1, 'must fail');
```

### 5スターから1チケット

専用の0残高childを作り、以下を順番に確認します。

1. 4スター付与後の交換はerror。残高は4スター・0チケット、交換logは0件。
2. さらに1スター付与後の交換は成功。残高は0スター・1チケット、交換logは1件。
3. 直後の再交換はerror。残高・log件数は不変。

```sql
select * from public.add_star_coin('<EXCHANGE_CHILD_UUID>', 4, 'exchange test');
select * from public.exchange_star_coins_for_ticket('<EXCHANGE_CHILD_UUID>'); -- fail
select * from public.add_star_coin('<EXCHANGE_CHILD_UUID>', 1, 'exchange test');
select * from public.exchange_star_coins_for_ticket('<EXCHANGE_CHILD_UUID>'); -- success
select * from public.exchange_star_coins_for_ticket('<EXCHANGE_CHILD_UUID>'); -- fail

select * from public.child_balances where child_id = '<EXCHANGE_CHILD_UUID>';
select count(*)
from public.reward_logs
where child_id = '<EXCHANGE_CHILD_UUID>' and type = 'star_coin_exchange';
```

同時実行検証は、sessionを維持できるdirect DB接続を2本用意し、5スターだけを持つ専用childへ両sessionから同時に交換を実行します。片方だけが成功し、もう片方は先行transaction終了後に5スター未満error、最終値は0スター・1チケット・交換log 1件であることを確認します。`FOR UPDATE`待機を見るため、SQL Editorのconnection再利用に依存せず、2つの`psql` sessionを推奨します。

### today taskの二重付与

1. Household Aに1チケットtaskとChild Aのpending today taskを作成する。
2. `complete_today_task`を1回実行し、ticketが1だけ増え、`reward_granted=true`、logが1件になること。
3. 同じIDで2回目を実行しerrorになること。
4. 残高とlog件数が増えないこと。
5. `today_tasks.reward_granted`の直接UPDATEが権限errorになること。

```sql
select * from public.complete_today_task('<TODAY_TASK_A_UUID>');
select * from public.complete_today_task('<TODAY_TASK_A_UUID>'); -- fail
update public.today_tasks set reward_granted = false where id = '<TODAY_TASK_A_UUID>'; -- fail
```

Parent BとしてAのtoday task IDを渡したRPCもaccess deniedであることを確認します。

### 掲示板報酬と二重付与

1. Household Aに`status='open'`、報酬1チケットのjobを作る。
2. Child Aのapplicantを作り、`status='completed'`と`completed_at`を設定する。
3. Child Bを同じjobへ応募させるINSERTが家庭一致trigger / RLSで失敗すること。
4. `approve_help_job_reward`を1回実行し、ticketが1だけ増え、applicantが`approved / reward_granted=true`、logが1件になること。
5. 同じIDで2回目を実行しerrorになること。
6. `reward_granted=false`への直接UPDATEとapplicant DELETEが権限errorになること。
7. Parent BからAのapplicant IDを渡したRPCがaccess deniedになること。

```sql
select * from public.approve_help_job_reward('<APPLICANT_A_UUID>');
select * from public.approve_help_job_reward('<APPLICANT_A_UUID>'); -- fail
update public.help_job_applicants set reward_granted = false
where id = '<APPLICANT_A_UUID>'; -- fail
delete from public.help_job_applicants where id = '<APPLICANT_A_UUID>'; -- fail
```

各RPCは1 PostgreSQL function call内で実行され、例外時には残高、status、logを含むstatement全体がrollbackされます。各失敗testの前後で3要素を比較し、部分更新がないことを確認します。

## 6. 結果記録

### 実行情報

| 項目 | 記録 |
|---|---|
| project / 環境 |  |
| project ref末尾4文字 |  |
| migration commit / file hash |  |
| 実行者 |  |
| 適用日時（JST） |  |
| backup / PITR復元点 |  |
| Email confirmation設定 | 要確認 / 有効 / 無効 |
| 適用方法 | SQL Editor / CLI |

### 判定表

| test | A→B | B→A | 結果 / 証跡 |
|---|---|---|---|
| 全10 table SELECT分離 |  |  |  |
| 他家庭INSERT拒否 |  |  |  |
| 他家庭UPDATE拒否 |  |  |  |
| 他家庭DELETE拒否 |  |  |  |
| household member自己昇格拒否 |  |  |  |
| owner member削除拒否 |  |  |  |
| balance直接変更拒否 |  |  |  |
| 不正child IDの全RPC拒否 |  |  |  |
| add RPCの0 / 負数拒否 |  |  |  |
| PAY負残高拒否・rollback |  |  |  |
| 5スター未満拒否 |  |  |  |
| 5スター交換成功 |  |  |  |
| 5スター同時実行 |  |  |  |
| today task二重付与拒否 |  |  |  |
| 掲示板child/job家庭一致 |  |  |  |
| 掲示板二重付与拒否 |  |  |  |
| reward log件数・内容 |  |  |  |

### 不具合記録

| ID | 手順 | 期待値 | 実結果 | SQLSTATE / message | 対応 | 再test |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

### 完了承認

- [ ] 全必須testがPASS
- [ ] failure時に部分更新がない
- [ ] `anon`にtable / RPCの不要権限がない
- [ ] フロントにservice role keyがない
- [ ] localStorage移行・自動同期を開始していない
- [ ] test account / test dataの保持または削除方針を記録した
- [ ] production適用可否を承認した
