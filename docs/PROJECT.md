# Project

## 概要

HAPICHIKE（ハピチケ）は、小学生向けのお手伝い・ごほうび管理用の静的Webアプリです。お手伝いの完了をチケットまたはスターコインに変え、チケットを使うルーレットで SweetsPAY / ToyPAY / GamePAY をため、家族と相談してごほうびに使う体験を提供します。実際のお金・課金・賭博機能はありません。

対象ユーザーは主に子どもと、そのお手伝い候補・報酬・ポイントを管理する保護者です。基本コンセプトは、アメリカンPOP／ルーレット／チケットの演出で日常のお手伝いを楽しく継続することです。

## 使用技術

- HTML5、CSS、Vanilla JavaScript（すべて `index.html` 内）
- ブラウザ `localStorage`
- HTML Audio / Web Audio API
- Node.js の標準 `fs` / `path` によるビルド
- Python `http.server` によるローカル配信
- Vercel の静的ホスティング設定

フレームワーク、パッケージ依存、サーバーAPI、データベースはありません。

## 主要画面

- 名前入力（初回・名前変更）
- お手伝い: やること、おわった、お手伝いリスト、履歴検索、一括選択
- ルーレット: 3ジャンル、BET 1〜5、ハピチャンカード
- ごほうび: 3種のPAY残高と使用、外出確認用カードのメール作成
- きろく: PAY交換、お手伝い完了、全履歴
- おうちの人用モーダル: お手伝い管理、報酬枚数、PAY振替、チケット付与、親メール

## 主な機能

- お手伝い候補の追加・編集・削除、今日のリストへの追加、完了、キャンセル
- チケット／スターコイン報酬、5スターから1チケットへの交換
- チケットBETと重み付きルーレット、PAYポイント加算
- ハピチャンカード獲得・予約使用
- PAYポイント使用・PAY間振替
- ありがとうスター、親からのチケット直接付与
- 履歴、バッジ、午前6時基準の日次リセット
- BGM／効果音設定とWeb Audioフォールバック
- `mailto:` による今日の残高カード共有

## ディレクトリ構造

```text
.
├─ index.html                 アプリ本体
├─ homecasino.html.txt        index.html と同一の互換用コピー
├─ public/audio/              外部音声の配置予定先
├─ scripts/build.js           dist 生成スクリプト
├─ dist/                      ビルド生成物（Git ignored）
├─ docs/                      現状ドキュメント
├─ package.json
├─ start-server.ps1
└─ vercel.json
```

## 起動・ビルド

ローカル起動:

```powershell
npm run dev
# または
.\start-server.ps1
```

ブラウザで `http://localhost:8000/` を開きます。`start-server.ps1` は Codex ランタイム配下の固定Pythonパスを利用するため、環境によっては `npm run dev` の方が移植性があります。

ビルド:

```powershell
npm run build
```

`scripts/build.js` は既存の `dist/` を削除して再作成し、`index.html`、`homecasino.html.txt`、`README.md`、`public/` をコピーします。

## 主な依存関係

`package.json` に dependencies / devDependencies はありません。実行時はモダンブラウザのみ、開発・ビルド時は Python または Node.js を利用します。
