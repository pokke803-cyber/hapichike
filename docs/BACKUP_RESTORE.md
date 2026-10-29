# Backup and restore

## Backup format

親設定の「データ管理」からJSONを書き出します。時刻は `createdAt` とファイル名の両方でUTCを基準にします。

```json
{
  "format": "hapichike-backup",
  "version": 1,
  "createdAt": "2026-10-22T01:02:00.000Z",
  "app": "hapichike",
  "data": {
    "kidsVegasCasino.v1": {},
    "kidsVegasCasino.parentEmail.v1": "parent@example.com"
  }
}
```

## Versioning

現在対応する形式はversion 1だけです。versionなしのlegacy JSONと、未知のfuture versionは自動変換せず拒否します。将来必要になった場合は別の明示的migration/import処理を用意します。

## Included data

対象は `kidsVegasCasino.v1` と `kidsVegasCasino.parentEmail.v1` の2キーだけです。主stateの子ども名、残高、PAY、ハピチャンカード、タスク、今日のタスク、履歴、音設定などを含みます。未知の安全な追加フィールドは保持し、forward compatibilityを確保します。親メールは個人情報なので、ファイルを安全な場所に保管してください。

## Excluded secrets

親用簡易パスワード、password、Supabase access/refresh token、Auth session、`STAGING_PARENT_*`、service roleなど、秘密情報に該当するキーは再帰的に除外します。対象2キー以外のlocalStorageは読み出さないため、Supabase SDKが保存するAuthキーも含みません。復元時の親用簡易パスワードはバックアップ値で置換せず、その端末の現在値を維持します。

## Validation

JSON構文、format、version、app、createdAt、dataと対象2キー、主state、残高とPAYの有限数値、既知の配列、task/today taskの最低限の型、音設定、親メール型を検証します。`NaN` / `Infinity` 相当と `__proto__` / `prototype` / `constructor` を拒否します。未知フィールド自体は拒否しません。

## Restore preview

ファイル選択だけでは書き込みません。日時、version、子ども名、チケット、スターコイン、3種PAY、ハピチャン、task/history件数、settings有無を `Current → Backup` で表示します。

## Safety backup

明示確認後、復元直前の対象データをversion 1 envelopeとして `kidsVegasCasino.restoreSafety.v1` に保存します。ここにも秘密情報は含めません。途中書き込みまたはreadback確認が失敗した場合、処理開始時のraw値を自動で書き戻します。

## Local-only restore

復元は対象localStorageキーへの書き込みとreadback確認だけを行います。`localStorage.clear()` は使わず、無関係なキーを変更しません。成功後に画面をreloadします。

## Future Supabase sync interaction

この復元は端末内データだけを対象とし、Supabase RPC、DB更新、initial import、event queue、sync metadataを一切呼びません。将来cloud syncを追加しても、復元したlocal snapshotを自動pushしてはいけません。明示的な比較・承認・importを別フローで設計します。
