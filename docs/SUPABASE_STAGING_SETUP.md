# Supabase staging setup

確認日: 2026-10-01

## Staging作成方法

- Supabase Dashboardで確認したところ、現在の `Pokke's Org` はFree planであり、persistent branchは「Upgrade to unlock persistent branches」と表示された。このため、persistent branch方式は現在のplanでは利用しない。
- 優先方針どおり、production projectのbranchではなく、独立したSupabase projectとして `hapichike-staging` を作成した。
- stagingのregionは `ap-southeast-1`（Southeast Asia / Singapore）。productionの `ap-northeast-1`（Tokyo）とも区別できる。

## Project ref

- staging project名: `hapichike-staging`
- staging project ref: `dhmkpqrfaukfbuoaenhk`
- 状態: `ACTIVE_HEALTHY`
- PostgreSQL major version: 17

Project URLとAPI keyの実値はこの文書へ記録しない。実値はGit管理外の `.env.local` だけに保存する。

## Productionとの区別方法

| 環境 | Project名 | Project ref | Region |
|---|---|---|---|
| production | `pokke-family-apps` | `rrdokjeuwewphmlncguq` | `ap-northeast-1` |
| staging | `hapichike-staging` | `dhmkpqrfaukfbuoaenhk` | `ap-southeast-1` |

Dashboardのproject名、Dashboard URL内のproject ref、CLIのproject一覧、`supabase/.temp/project-ref` の4点で照合した。stagingとproductionのref、DB host、regionは別である。

## Environment variables

`.env.local` に次の2変数を設定済み。

```dotenv
VITE_SUPABASE_URL=<staging Project URLを設定済み>
VITE_SUPABASE_ANON_KEY=<staging Publishable keyを設定済み>
```

- `.env.local` は `.gitignore` 対象であることを確認した。
- `VITE_SUPABASE_ANON_KEY` にはDashboardのPublishable keyを使用した。
- secret key、legacy `service_role` key、DB passwordはフロントエンド環境変数へ保存していない。
- `.env.example` に実値を書いていない。

## Link状態

- CLI link先: `dhmkpqrfaukfbuoaenhk`
- CLI project一覧で `hapichike-staging` の `linked` が `true`、productionの `linked` が `false` であることを確認した。
- `supabase/.temp/project-ref` が `dhmkpqrfaukfbuoaenhk` と一致することを確認した。
- link後にDashboardのproject名とrefを再照合した。

## Migration list

実行コマンド:

```text
npx supabase migration list
```

終了コードは0。結果は次のとおり。

| Local | Remote |
|---|---|
| `202609290001` | 未適用 |
| `202609290002` | 未適用 |

remote migration historyは空で、localの2 migrationはstagingへ未適用である。`db push`、`db pull`、`migration repair` は実行していない。

## Baseline未解決事項

- 既存2 migrationは `public.profiles` と旧 `public.children` が既に存在することを前提にするため、空のstagingへそのままpushすると失敗する可能性が高い。
- production schemaとproduction migration historyは今回取得していない。
- baselineはarchiveや文書から推測して手書きせず、productionから読み取り専用の手順で取得する必要がある。
- baselineのversionは、productionのremote migration historyを確認してから、既存2本より前かつ衝突しない値を決める必要がある。
- Docker API互換container runtimeが未導入のため、shadow DBを使う正式な`db pull`手順はまだ開始できない。
- `profiles` / `children` の列、constraint、RLS、policy、grant、row数、およびmanaged schema customizationは要確認。

## Production保護ルール

- production ref `rrdokjeuwewphmlncguq` へ、このstaging検証作業からlinkしない。
- remote操作前にproject名とproject refを必ず再確認する。
- productionに対して `db push`、`db reset --linked`、remote SQL、`migration repair` を実行しない。
- production baseline取得は読み取り専用の別工程として明示承認後に行い、remote migration history更新promptには同意しない。
- 既存2 migrationのファイル名、timestamp、SQL本文を変更しない。
- archive SQLをmigration runnerの対象へ戻さない。
- DB password、secret key、service role keyをGit管理ファイルまたはフロントエンドへ置かない。

## 次の手順

1. production baseline取得専用の作業ブランチまたは隔離した作業コピーを用意する。
2. productionを変更しない読み取り専用手順をレビューし、対象project refを明示して承認する。
3. Docker API互換container runtimeを導入・起動する。
4. productionのmigration historyを読み取り専用で記録する。
5. 既存2 migrationを変更せず一時退避し、production schemaからbaselineを取得する。remote履歴更新は拒否する。
6. baseline SQLをレビューし、`baseline -> 202609290001 -> 202609290002` の順でclean local DBを再現する。
7. staging refを再確認し、`migration list` と`db push --dry-run`で適用予定を確認する。
8. 承認後にのみstagingへ適用し、RLS / RPCを検証する。

staging環境の準備は完了しているため、次はbaseline取得の準備工程へ進める。ただし、実際のproduction `db pull` は今回の範囲外であり、container runtimeの準備とproduction読み取り専用手順の別承認が必要である。
