# HAPICHIKE

小学生向けの、お手伝いとごほうびを楽しむ静的Webアプリです。
お手伝いでチケットを集め、BETを選んでルーレットを回し、「お菓子」「おもちゃ」「ゲーム」のジャンル別ポイントをためてごほうびと交換できます。

## 公開方法 GitHub + Vercel

1. このフォルダの中身をGitHubリポジトリにpushします。
2. Vercelで `Add New Project` を選び、そのGitHubリポジトリをImportします。
3. Framework Presetは `Other` のままでOKです。
4. Build Commandは空欄、Output Directoryも空欄のままDeployします。
5. VercelのURLで `index.html` がトップページとして表示されます。

## ローカルテスト

PowerShellでこのフォルダを開き、次を実行します。

```powershell
.\start-server.ps1
```

ブラウザで開きます。

```text
http://localhost:8000/
```

`index.html` を直接ブラウザで開いても確認できます。

## ファイル構成

- `index.html`: Webアプリ本体
- `vercel.json`: Vercel用の静的サイト設定
- `package.json`: プロジェクト情報
- `start-server.ps1`: ローカルテスト用サーバー
- `homecasino.html.txt`: 元データ互換用コピー

## データ保存

ユーザーのチケット、ポイント、履歴はブラウザの `localStorage` に保存されます。
Vercelに公開してもサーバー側のデータベースは使いません。
