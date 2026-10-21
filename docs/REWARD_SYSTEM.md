# Reward system

## チケット

残高は `state.coins` に保存します。お手伝い完了、5スター交換、親の直接プレゼント、ルーレット通常0P時の1枚返却で増えます。ルーレット開始時にBET分を減らします。完了報酬は `TodayTask.ticketGranted` と完了statusで二重付与を防止します。BET時は残高不足ガードがあり、回すボタンもdisabledになります。

## スターコイン

残高は `state.starCoins`。スター報酬型のお手伝い完了、またはTOPの「ありがとうスター」で増えます。ありがとうスターは1回1枚、40文字以内のメッセージ必須、ブラウザ確認あり、親パスワードなしです。メッセージ候補 `starGiftHistory` は最大20件で、完全一致の再利用時は先頭へ移動します。

5枚以上なら1回の操作につき5枚を減らし、チケットを1枚増やします。複数口の一括交換はなく、交換ログは `starCoinExchange` です。5枚未満ではボタン無効に加え関数側でも停止し、不足枚数を表示します。

## PAYポイント

- SweetsPAY: `points.snack`
- ToyPAY: `points.toy`
- GamePAY: `points.game`

選択中ジャンルのルーレット結果で増えます。ごほうび画面では1以上の整数を残高以内で使用し、減算と `payLogs` を保存します。親管理では異なるPAYへ1:1で振替でき、`transferHistory` に最大50件残します。

## ハピチケSHOP

具体的な商品、価格、在庫、交換承認はありません。任意のポイント数を「つかう」ことで、家族と相談したごほうび利用を記録する画面です。

## 履歴

チケットプレゼントは `ticketGiftLogs` と一般 `history` の両方、PAY使用は `payLogs` と一般履歴、PAY振替は `transferHistory` と一般履歴、スター関連は一般履歴に保存します。各上限は `STORAGE.md` を参照してください。

## Supabase RPC基盤（未接続）

将来の子ども別DB残高では、`add_ticket`、`add_star_coin`、`exchange_star_coins_for_ticket`、`adjust_pay_balance`、`complete_today_task`、`approve_help_job_reward`を使用します。各RPCは家庭所属を検証し、残高と`reward_logs`を同じDB transactionで更新します。5スター交換は残高行を`FOR UPDATE`して`star_coins >= 5`を判定し、task完了と掲示板報酬も対象行lockと`reward_granted = false`確認により競合・二重付与を防ぎます。

これらは現行localStorageロジックを置換しておらず、UIから未使用です。
