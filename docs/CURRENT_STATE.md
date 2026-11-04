# Current state

調査基準: 2026-11-04。理想仕様ではなく、現行UIと追加済みSupabase基盤の状態を記録しています。

## 実装済み

- 子どもの名前入力と名前変更（最大12文字）
- 6件の初期お手伝い候補、カテゴリー・難易度・アイコン・報酬の管理
- 今日のやることへの個別／複数／履歴からの追加、完了、未完了のキャンセル
- チケットまたはスターコインの完了報酬と `ticketGranted` による同一項目の二重付与防止
- ありがとうスターの直接付与、候補履歴20件
- スターコイン5枚からチケット1枚への交換
- 親によるチケット1〜10枚の直接付与
- 3種のPAY、BET 1〜5の重み付きルーレット、PAY使用・振替
- ハピチャンカードの獲得と次回ルーレットへの+1P予約
- 一般履歴40件、PAY使用50件、振替50件、チケット付与50件、お手伝い検索履歴80件
- 午前6時を境界にした今日のリストの自動／手動リセット
- 親パスワードによる簡易ロック
- 親メール設定と `mailto:` による残高カードのメール作成
- BGM／効果音ON/OFF保存、音源失敗時のWeb Audioフォールバック
- 親設定からのversion 1 JSONバックアップ、検証付きプレビュー、localStorage限定の復元、復元直前safety backup
- レスポンシブ表示と `prefers-reduced-motion` 対応
- `/parent` の親スマホ用 Supabase 閲覧専用ダッシュボード（Auth、家庭／子ども切替、残高、最近の履歴）
- 親設定のクラウド連携に、backup・mapping・role・Cloud未初期化を確認する初回snapshot import UI（明示承認後の専用RPCのみ）
- `kidsVegasCasino.v2` のUUIDローカルプロフィール、active Child切替、Child別残高・割当・履歴・進捗・reset分離
- v2 activation後の共通Local State adapter（v1へのfallbackを行わないfail-closed方式）
- legacy v1の所有者明示migration、v2 backup/restore preview、v2 Cloud mappingとreward child resolver

## 現在の画面構成とモード

メインタブは「お手伝い」「ルーレット」「ごほうび」「きろく」の4つです。お手伝いタブには「やること」「おわった」「お手伝いリスト」の3状態があります。一括選択モーダルには通常選択モードと、親パスワード解除後の編集モードがあります。親管理は画面右下の「おうちの人用」から開くモーダルです。

## 保存方式

子ども側の実データはブラウザの localStorage のみです。未移行時は `kidsVegasCasino.v1`、v2 activation後は `kidsVegasCasino.v2` のactive profileをSource of Truthにします。v1は削除・更新せず安全確認用に保持します。親メールは `kidsVegasCasino.parentEmail.v1` に保存します。親用 `/parent` は Supabase を閲覧し、同一originのLocal v1/v2、mapping、backup metadataを比較表示します。

## Supabase基盤（親閲覧画面のみ接続）

- remote DBには現在`profiles`と旧`parent_id`方式の`children`だけがあり、どちらも実データは0件。
- 共通family coreと`children.household_id`移行のmigration 2本を作成済みだが、remote DBへは未適用。
- `household_members`により複数親を許容し、全家庭データをhousehold単位のRLSで分離する設計。
- 親だけがemail/passwordのSupabase Auth userとなり、子どもは`children`プロフィールとして扱う。
- ハピチケ固有schemaの旧SQLはarchiveへ退避済みで、`hapichike_*`への再設計は未実施。
- 現在の簡易親パスワード`1234`はlocalStorageに残る別機能で、Supabaseへ送信しない。
- `/parent` は Supabase Auth と SELECT API だけを使う。更新系 API/RPC、自動sync、localStorage書込みは行わない。Local参照はCloud管理の比較・preview用に限る。

## 現在の制約・未完成機能

- 実legacy migration apply、実v2 mapping保存、実データでの最終activationは親の明示確認が必要です。
- JSONバックアップ／復元と、明示承認による1回限りのSupabase initial importは実装済みです。通常のcloud syncは未実装です。
- 外部MP3は全て未配置です。Web Audioフォールバックで操作は継続できます。
- お手伝い状態に `inProgress` の互換処理はありますが、現行UIに開始操作はなく、追加後は直接完了します。
- 親パスワードの変更UIは確認できません。
- ごほうびSHOPは具体的な商品カタログではなく、PAYポイントの任意数量使用画面です。
- メール共有は送信完了を検証せず、端末のメール作成画面を開くだけです。
- 親の閲覧用 Auth UI と子ども別DBデータ表示は実装済みです。編集機能、子ども別データ移行、Supabase同期は未実装です。
- version付きJSONバックアップとlocal-only復元は実装済みです。Supabase移行前の次工程はread-only mapping比較です。

## 特殊処理

- 午前6時より前は前日扱いとなり、境界を越えると `todayTasks` が空になります。
- ルーレットの通常0P枠はBET済みチケットを1枚だけ返します。ハピチャン枠は0Pでカードを1枚付与します。
- `normalizeState` が不足フィールド・旧カテゴリー・旧タスク状態を補完し、起動直後に保存し直す場合があります。
- 履歴表示では完了履歴が「お手伝いかんりょうきろく」と「ぜんぶのきろく」の両方に現れます。

## 確認できる問題

重大度順の一覧は `KNOWN_ISSUES.md` を参照してください。特に、子ども別データ未分離、バックアップ不在、平文の簡易パスワード、履歴削除の部分的な挙動、音声アセット未配置が継続開発時の主要注意点です。
