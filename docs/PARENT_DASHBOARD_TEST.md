# 親ダッシュボード実環境テスト記録

> **停止中:** この記録は旧一体型ハピチケSQLを前提としています。旧SQLはarchiveへ退避済みで実行禁止、共通family coreはremote未適用、ハピチケ固有schemaは未再設計です。以下の準備手順を現在のDBへ実行してはいけません。

実行日: 2026-09-20 (JST)

旧対象: `/parent`、`supabase/archive/20260919_initial_hapichike_schema.sql.archived`

接続先 project / 環境: **未設定**

## 事前確認

| 項目 | 結果 | 証跡 / 補足 |
| --- | --- | --- |
| `.env` / `.env.local` | FAIL | ワークスペースに存在しない。実値は未設定。 |
| `VITE_SUPABASE_URL` | FAIL | `.env.example` に空テンプレートのみ。 |
| `VITE_SUPABASE_ANON_KEY` | FAIL | `.env.example` に空テンプレートのみ。 |
| service_role key のフロント混入なし | PASS | `.env.example`、`parent/`、`src/` を検索し、service role key / 参照は検出されなかった。 |
| 実接続先 Supabase project | FAIL | project ref、URL、環境種別が未提供。 |
| Auth 設定 | FAIL | remote Dashboard にアクセスしていないため、Email provider と Email confirmation の状態は未確認。 |
| migration remote 適用状態 | FAIL | remote project 未特定のため未照合。migration ファイル自体は存在する。 |

`.env.example` は維持する。実値は Git 管理対象外の `.env.local` にだけ設定する。

```dotenv
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

`service_role` key、DB password、親の password を `.env.local`、ソース、テスト記録へ入れてはいけない。

## staging / test 環境での準備手順

本番への適用・データ作成は行っていない。staging / test project に限り、次の順で実施する。完全な migration 衝突確認、backup、RLS SQL は [SUPABASE_TEST_PLAN.md](SUPABASE_TEST_PLAN.md) を使う。

1. Dashboard で対象 project ref と環境名を確認し、migration 未適用であることを確認する。
2. Backup / PITR 復元点を記録する。
3. 旧`20260919_initial_hapichike_schema.sql.archived`は適用しない。共通family coreと将来の`hapichike_*` migrationに対応したテスト計画が完成するまで停止する。
4. Authentication > Users で Parent A / Parent B のテスト用 email/password user を作り、email confirmation が有効なら両方を確認済みにする。各 UUID を記録する。
5. `SUPABASE_TEST_PLAN.md` の「Auth準備とテストデータ作成」の `authenticated` claim 手順で、Parent A に Household A と Child A、Parent B に Household B と Child B を作成する。child 作成 trigger により `child_balances` の初期行が作成されることを確認する。
6. 各親の認証コンテキストで `add_ticket`、`add_star_coin`、`adjust_pay_balance` RPC を呼び、残高と reward log を作る。Child A の例は tickets=5、star_coins=3、sweets_pay=10、toy_pay=4、game_pay=2。happy_chance_cards=1 は既存 RPC がないため、**staging の管理者 SQL Editor でのみ**対象の balance 行を更新する。Child B は異なる値にする。
7. reward log は各 child に少なくとも数件作成する。RPC 呼出しで生成される log を優先し、必要な追加 fixture は staging の管理者接続だけで作成する。
8. `.env.local` を設定して `npm run dev` で `/parent` を開く。値や parent password を Git / スクリーンショット / この文書に残さない。

## 実機確認結果

実 Supabase の接続情報・テストアカウントがないため、下表の remote / ブラウザ統合テストは未実施であり、PASS と扱わない。

| 確認項目 | 結果 | 補足 |
| --- | --- | --- |
| Parent A email/password ログイン | FAIL | 接続先・テスト user 未設定。 |
| Parent B email/password ログイン | FAIL | 接続先・テスト user 未設定。 |
| 間違った email / password の表示 | FAIL | remote Auth 未接続。実装上は `Invalid login credentials` を日本語メッセージへ変換する。 |
| 未ログイン状態 | FAIL | remote Auth 未接続。実装上はログイン画面を表示する。 |
| session 切れ / logout 後 | FAIL | remote Auth 未接続。実装上は auth state change でログイン画面へ戻す。 |
| Parent A: Household A のみ | FAIL | RLS 実DB未検証。 |
| Parent B: Household B のみ | FAIL | RLS 実DB未検証。 |
| children 一覧と子ども切替 | FAIL | 実データ未接続。 |
| Child A / B balances 表示 | FAIL | 実データ未接続。 |
| reward_logs 表示 | FAIL | 実データ未接続。 |
| Parent A から Household B / Child B ID を直接 SELECT | FAIL | RLS 実DB未検証。`SUPABASE_TEST_PLAN.md` の A→B / B→A SELECT を実施すること。 |
| household 0件の空状態 | FAIL | 実認証 user 未接続。実装済み。 |
| child 0件の空状態 | FAIL | 実認証 user 未接続。実装済み。 |
| balance なしの空状態 | FAIL | 実認証 user 未接続。実装済み。 |
| reward log 0件の空状態 | FAIL | 実認証 user 未接続。実装済み。 |
| `/parent` の console error | FAIL | 成功ログイン・データ取得を実行できないため未判定。 |
| production build | PASS | `npm run build` 成功。`dist/parent/index.html` を生成。 |
| localStorage 未変更 | PASS | 今回 `index.html`、`homecasino.html.txt`、localStorage 処理を変更していない。`/parent` は localStorage API を参照しない。 |

## RLS 合格条件

Parent A の JWT で Household B ID / Child B ID を指定した `households`、`children`、`child_balances`、`reward_logs` SELECT がすべて **0 行**であること。Parent B → A も同様であること。これはフロントの絞込みではなく、RLS policy が返却を拒否することで判定する。

## 残課題

- staging / test の project URL と anon key を `.env.local` に設定する。
- migration の remote 適用状況と Auth の Email provider / confirmation 設定を確認する。
- Parent A/B と fixture を作成し、上表の FAIL 項目を実測で PASS / FAIL に更新する。
- 成功ログイン、切替、空状態、logout、session expiry のブラウザ console を確認する。
