# HAPICHIKE Codex guide

HAPICHIKE（ハピチケ）は、小学生がお手伝いでチケットまたはスターコインを集め、ルーレットで3種類のPAYポイントを得て、ごほうびに使う静的Webアプリです。

作業前に `docs/CURRENT_STATE.md` を確認してください。調査対象に応じて `docs/DATA_STRUCTURE.md`、`docs/CORE_LOGIC.md`、`docs/STORAGE.md` など必要な文書とコードだけを読み、少ないコンテキストで進めてください。

## 作業原則

- 現在のコードで確認できる挙動を正とし、不明点は `UNKNOWN` または「要確認」とする。
- 既存機能・UI・保存データとの互換性を壊さない。
- 指示されていないUI変更、unrelated refactor、大規模整理をしない。
- 最小変更を優先し、変更対象外のファイルに触れない。
- localStorage の既存キー・構造を変更する場合は、明示的な指示と移行・復元計画が必要。
- `dist/` は生成物。依頼なしに直接編集・削除しない。
- Git commit / push は明示的に依頼された場合だけ行う。特に push は自動で行わない。

## 現在の主要ファイル

- `index.html`: HTML・CSS・JavaScriptを含むアプリ本体
- `homecasino.html.txt`: 現在は `index.html` と同一内容の互換用コピー
- `scripts/build.js`: 静的ファイルを `dist/` にコピーするビルド
- `public/audio/`: 外部音声の配置予定先（音声ファイルは未配置）
- `docs/`: 現状仕様・設計・既知問題
