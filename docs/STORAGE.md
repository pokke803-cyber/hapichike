# Storage

## 使用方式

実データはブラウザlocalStorageのみを使用します。IndexedDB、sessionStorage、Cookie、JSONファイル、サーバーデータベースへの保存は使っていません。Supabase用のmigration、RLS、RPC、API層はありますが、remote DBには未適用で、現行UIも呼び出さず、自動同期・移行もしません。

Supabase設定はVite環境変数 `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を将来用に参照します。未設定時はlocalStorage-onlyモードで動作します。`.env`はGit管理せず、service_role keyは絶対にフロントエンドへ置きません。

## localStorageキー

| キー | 内容 | 初期値／補足 |
|---|---|---|
| `kidsVegasCasino.v1` | `state` 全体。名前、残高、タスク、履歴、親設定、音設定など | 保存がない／JSON不正／tasks不在なら初期状態 |
| `kidsVegasCasino.parentEmail.v1` | 親メール文字列 | 空文字。主状態内の旧 `parentEmail` より優先 |

主キーの詳細と保存フィールドは `DATA_STRUCTURE.md` を参照してください。

## 初期値と補完

- 子どもの名前、履歴、バッジ、親メール: 空
- チケット、スターコイン、ハピチャンカード、全PAY: 0
- 親パスワード: `1234`
- 音: BGM/SFX有効、音量0.22/0.62
- お手伝い候補: 6件
- `lastDailyResetKey`: 午前6時基準の当日キー

`normalizeState` は読込時に不足フィールドを初期化し、数値をNumber化し、負のスター／カードを0へ丸めます。タスク報酬は1〜5へ丸め、旧 `done`、`completed`、`finished`、`doing` などを現行statusへ変換します。旧カテゴリー `living` は `creature`、`other` / `study` / 不正値はタイトル・アイコンから推定します。旧タスク状態から `todayTasks` を生成する移行もあります。

不足や移行を検出した場合は、アプリ起動直後に同じキーへ正規化済み状態を上書きします。スキーマversionフィールド、段階的migration番号、移行前バックアップはありません。

## 履歴上限

| フィールド | 保存上限 | 表示上限／重複処理 |
|---|---:|---|
| `history` | 40 | 全件。先頭が最新 |
| `payLogs` | 50 | 全件 |
| `transferHistory` | 50 | 親画面10件、履歴画面は全件 |
| `ticketGiftLogs` | 50 | 親画面8件 |
| `taskHistory` | 80 | title+categoryでupsert、最終利用順 |
| `starGiftHistory` | 20 | 完全一致を除外し再利用を先頭へ。候補表示8件 |

依頼で重点指定された「履歴候補20件」は `starGiftHistory` に実装されています。他の履歴候補で20件制限の実装はありません。

## 消えると困るデータ

`kidsVegasCasino.v1` を失うと、チケット、スターコイン、カード、全PAY、お手伝い候補・今日の状態、全履歴、親パスワード、名前、バッジ、音設定が失われます。親メールは別キーにもあるため主キーだけの消失では残る可能性があります。ブラウザデータ削除、別ブラウザ／別端末／別オリジンへの移動でデータは引き継がれません。

## Export / Import / Backup / Restore

すべて未実装です。JSONダウンロード、FileReader、復元バリデーション、復元前退避、子ども別バックアップはありません。詳細は `BACKUP_RESTORE.md` を参照してください。

## リスク

- 単一キー・単一端末で、バックアップも同期もない。
- `localStorage.setItem` の失敗を捕捉しない。
- スキーマversionと移行前退避がないため、正規化の誤りが保存時に確定する可能性がある。
- 親パスワードと多くの家庭データが平文で、同一オリジンのJavaScriptから読める。
- 子ども名を変更しても保存領域は切り替わらない。
- 親メールが主状態と専用キーに重複し、専用キーが優先される。
