# Known issues

状態はすべて2026-09-12の静的コード調査に基づきます。優先度はデータ消失・不正操作・継続開発リスクを基準にした整理上の提案です。

| ID | 内容 | 関連ファイル | 影響範囲 | 優先度 | 状態 |
|---|---|---|---|---|---|
| KI-001 | 子ども別データが未実装。`childName` を変えても同じ残高・タスク・履歴を共有し、選択中プロフィールIDもない | `index.html` | 全保存データ | 高 | 未対応 |
| KI-002 | JSONバックアップ／復元、移行前退避、端末間同期がない | `index.html` | 全保存データ | 高 | 未実装 |
| KI-003 | 親パスワードは主状態に平文保存、初期値は `1234`、変更UIなし。認証ではなく同一ブラウザ内の簡易ロック | `index.html` | 親管理全体 | 高 | 仕様上の制約 |
| KI-004 | 「きろくを消す」は `history`、`payLogs`、`badges` だけを消し、`transferHistory`、`ticketGiftLogs`、`taskHistory`、`starGiftHistory` は残る。画面上のPAY交換ログには振替履歴が残る | `index.html` | 履歴表示・プライバシー | 高 | 実装と表示名のずれ |
| KI-005 | 外部MP3 9種が未配置。全参照が読込エラーとなりWeb Audioフォールバックへ移行する | `public/audio/README.md`, `index.html` | 音声体験 | 中 | 未配置 |
| KI-006 | TOPの「ありがとうスター」は親パスワード不要で、子ども画面からスターコインを自己加算できる | `index.html` | スターコイン・チケット交換 | 高 | 現行仕様／要確認 |
| KI-007 | 「きろくを消す」「今日の状態をリセット」「PAYポイントをつかう」「なまえを変える」も親ロック外。どこまで子ども操作を許すか仕様不明 | `index.html` | 履歴・今日タスク・PAY・名前 | 中 | 要確認 |
| KI-008 | `useHappyChanceCard` は結果後使用を実装しているが、結果生成時に常に `canUseCard: false` のため到達不能。現行は抽選前予約だけ | `index.html` | ハピチャンカード | 低 | 未接続コード |
| KI-009 | お手伝いstatusに `inProgress` / `startedAt` があるが開始ボタンがなく、UIはidleから直接doneへ遷移 | `index.html` | お手伝い状態 | 低 | 未接続状態 |
| KI-010 | 完了・PAY使用・振替などが専用区分と「ぜんぶのきろく」に重複表示される | `index.html` | 履歴UI | 低 | 現行仕様 |
| KI-011 | PAY交換ログは `payLogs` を全件並べた後に `transferHistory` を全件並べるため、両種を日時順に統合していない | `index.html` | 履歴順序 | 低 | 現行仕様 |
| KI-012 | `addHistory` が途中保存し、その後の関連状態変更を別の `saveState` で保存する処理があり、原子的ではない | `index.html` | チケット付与等 | 中 | 技術的制約 |
| KI-013 | メール共有は `mailto:` を開いた時点で共有履歴を追加し、実際の送信成否を確認しない | `index.html` | メール共有履歴 | 低 | 仕様上の制約 |
| KI-014 | `README.md` のVercel手順はBuild Command/Output Directoryを空欄と説明する一方、`vercel.json` は `npm run build` / `dist` を指定する | `README.md`, `vercel.json` | デプロイ手順 | 中 | 文書不整合 |
| KI-015 | `start-server.ps1` はユーザープロファイル配下のCodex固有Pythonパスに依存する | `start-server.ps1` | ローカル起動 | 低 | 移植性制約 |
| KI-016 | `normalizeState` はスキーマversionや退避なしに既存データを補完して保存し直す | `index.html` | 既存データ保護 | 中 | 技術的制約 |
| KI-017 | localStorage書込失敗（容量・無効化等）を捕捉せず、UI上は成功表示になり得る | `index.html` | 全保存操作 | 中 | 未対応 |
| KI-018 | 親メールが主状態と専用キーに重複し、専用キー優先。片方のみの編集・消失で状態理解が難しい | `index.html` | 親メール | 低 | 重複保存 |
| KI-019 | フォーカストラップ等の完全なモーダルアクセシビリティは確認できない | `index.html` | キーボード操作 | 低 | 要確認 |
| KI-020 | Supabase schema/RLS/RPC/Auth API基盤は作成済みだがremote未適用かつUI未接続。Auth UI、親画面、同期、移行、復元UIは未実装 | `supabase/`, `src/`, `docs/` | 将来の複数端末／親管理 | 高 | 基盤のみ対応 |
| KI-022 | `household_members`への追加はowner限定だが、招待・受諾・owner不在防止の運用フロー/UIは未実装 | `supabase/` | 複数親管理 | 中 | 未実装 |

現行アプリ本体`index.html`に`TODO` / `FIXME`の明示コメントはありません。将来APIには選択中child取得のTODOが残っています。Gitリポジトリは存在するため「Git未管理」問題はありません。
