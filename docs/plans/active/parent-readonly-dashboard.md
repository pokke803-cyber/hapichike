# Task
親用閲覧専用ダッシュボード

## Goal

Supabase Auth でログインした親が、自分の所属家庭にある子ども別の残高と最近の報酬履歴をスマホから閲覧できるようにする。更新、同期、localStorage への読み書きは行わない。

## Scope

- `/parent` 用の独立したログイン／ダッシュボード画面
- email/password の Supabase Auth
- 所属家庭、子ども、残高、最近の reward log の SELECT
- 複数家庭と複数子どもの切替
- ローディング、空状態、接続／取得エラー
- 390px 前後を優先したレスポンシブ UI

## Files to inspect

- `AGENTS.md`
- `docs/CURRENT_STATE.md`
- `docs/API.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/PARENT_CONTROLS.md`
- `docs/REWARD_SYSTEM.md`
- `docs/SUPABASE_TEST_PLAN.md`
- `src/lib/supabaseClient.js`
- `src/services/api/`
- `supabase/archive/20260919_initial_hapichike_schema.sql.archived`（旧設計・実行禁止）
- `package.json`
- `vercel.json`

## Files allowed to modify

- `docs/plans/active/parent-readonly-dashboard.md`
- `docs/CURRENT_STATE.md`
- `docs/API.md`
- `docs/PARENT_CONTROLS.md`
- `src/services/api/householdsApi.js`
- `src/services/api/childrenApi.js`
- `src/services/api/rewardsApi.js`
- `src/services/api/historyApi.js`
- `parent/index.html`
- `parent/parent.css`
- `parent/parent.js`
- `vite.config.js`

## Files not to modify

- `index.html`
- `homecasino.html.txt`
- `dist/`
- `supabase/migrations/`
- 既存 localStorage 処理と子ども画面のロジック
- 更新系 API / RPC

## Current behavior

子ども向けの現行 UI は localStorage だけをデータソースとし、Supabase Auth/API 基盤は UI から未使用。親管理は簡易親パスワードで保護された同一画面内モーダルだけで、スマホ別端末からの閲覧画面はない。

## Desired behavior

未ログイン時は認証フォームだけを表示する。認証後は RLS 下で取得できる所属家庭だけを候補にし、家庭と子どもの切替に合わせて残高と最新10件の履歴を表示する。

## Data sources

- Supabase Auth: 親の session/user
- `households` / `household_members`: RLS で許可された所属家庭
- `children`: 選択家庭の子ども
- `child_balances`: 選択子どもの残高
- `reward_logs`: 選択子どもの最新10件

## UI structure

1. Supabase 未設定案内または親ログイン
2. ヘッダー（ログイン中の email、ログアウト）
3. 家庭セレクト（複数所属に対応）
4. 子ども切替ボタン
5. 6種の残高カードとスター 5 枚までの進捗
6. 最近のがんばり／reward log

## Error states

- Supabase 未設定
- 未ログイン（ログイン画面）
- 所属家庭なし
- 子どもなし
- 残高行なし
- reward log 0件
- Auth/API 取得失敗

## Implementation plan

1. SELECT API に小さな閲覧用 alias/件数制限を追加する。
2. `/parent` の HTML/CSS/JS を追加し、Auth 状態から家庭→子ども→残高・履歴の順で読み込む。
3. 家庭／子ども切替、ローディング、空状態、エラーを実装する。
4. Vite の multi-page build に親画面を含める。
5. 指定ドキュメントを最小更新する。
6. build、静的検査、スマホ幅の表示を確認する。

## Verification

- 未認証時にデータ UI を表示しない
- SELECT 以外の API/RPC が親画面から参照されていない
- localStorage 参照／書き込みがない
- 家庭・子ども切替時に child ID 付き SELECT を再実行する
- 空結果が各案内表示になる
- 390px/430px で水平スクロールが発生しない
- `npm run build` が成功する

## Result

- `/parent` の独立した閲覧専用画面を追加。Supabase未設定、未ログイン、家庭なし、子どもなし、残高なし、履歴0件、API失敗を表示できる。
- Auth user id に対する `household_members` SELECT から所属家庭を取得し、家庭、子ども、残高、reward log を順に読み込む。
- 複数家庭セレクト、子どもタブ、6種の残高、スター進捗、最近のお手伝いと報酬履歴を実装。
- 親画面からは SELECT API のみ参照し、更新系 API/RPC と直接の localStorage API は参照しない。
- `npm run build` 成功。`dist/parent/index.html` の出力を確認。ブラウザのスマホ幅検査で水平overflowとconsole errorなし。
- remote Supabase は未設定のため、実アカウントでのA/B家庭RLSテストは未実施。RLS migrationと実DBテスト手順は変更していない。
