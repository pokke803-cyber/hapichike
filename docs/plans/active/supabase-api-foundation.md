# Task

Supabase API接続基盤

## Goal

既存のlocalStorage中心アプリを変更せず、将来の親画面・複数端末対応に使うSupabase API層とデータ設計を追加する。

## Scope

- Supabase環境変数の雛形、クライアント、APIサービス、設計・同期文書を追加する。
- API未設定時は明示的な未接続モードで失敗せず、既存の画面・localStorage処理を維持する。

## Files to inspect

- `package.json`, `scripts/build.js`, `index.html`
- `docs/CURRENT_STATE.md`, `docs/STORAGE.md`, `docs/DATA_STRUCTURE.md`, `docs/KNOWN_ISSUES.md`

## Files allowed to modify

- `.gitignore`, `.env.example`, `package.json`, `scripts/build.js`, `index.html`
- `src/lib/`, `src/services/api/`
- `docs/`（指定文書とこの計画書）

## Files not to modify

- `dist/`
- `homecasino.html.txt`
- 既存のlocalStorageキー、状態構造、ゲーム・ルーレット・PAY・お手伝いの処理

## Current behavior

アプリは単一HTML内のJavaScriptでlocalStorageを唯一の永続化先として利用し、Supabase・API・子どもIDは存在しない。

## Desired behavior

Viteの`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`を任意で読み込み、設定済みの場合だけ将来用API層がSupabaseを利用できる。未設定の場合は警告のみで既存アプリがlocalStorageだけで動く。

## Implementation plan

1. `.env`を除外し、空値の`.env.example`を追加する。
2. Vite/Supabase依存を設定し、既存静的ビルドが`src`も配布できるようにする。
3. クライアントと共通APIユーティリティを追加し、未接続時の安全なエラーを統一する。
4. children、rewards、tasks、history、settings、helpJobsのAPI雛形を追加する。既存UIからは呼び出さない。
5. DBスキーマ、API、同期・移行戦略を文書化し、現状文書に接続基盤の制約を追記する。
6. ビルドと静的検査を実行し、既存localStorageコードに変更がないことを確認する。

## Verification

- `.env.example`が空値のみで、`.env`がGit除外されている。
- Supabase未設定でもクライアントの取得は安全に失敗し、既存HTMLに接続コードがない。
- `npm run build`が成功し、`dist`は直接編集していない。

## Result

実施済み。Supabaseクライアント、6つのAPIモジュール、環境変数雛形、スキーマ/API/同期方針文書を追加した。既存UIはAPIを呼ばず、Supabase未設定時は警告してlocalStorage-onlyモードを継続する。`npm run build`は成功した。既存localStorageキー・状態・ゲーム処理には変更を加えていない。
