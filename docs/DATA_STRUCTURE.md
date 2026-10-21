# Data structure

## 保存単位

主状態は localStorage `kidsVegasCasino.v1` の1オブジェクトです。主キー相当は task系の `id` / `taskId` ですが、DB制約はありません。以下はコードから確認できる実質的な型です。

Supabase側には家庭、member、children、子ども別残高、tasks/today tasks、掲示板、reward logs、parent settingsの正規化schemaを用意しています。ただし現行localStorageとの対応付け・変換・同期は未実装であり、下記local stateの構造は変更していません。

```js
state = {
  childName: string,             // 最大12文字。プロフィールIDではない
  coins: number,                 // 所持チケット数（変数名は coins）
  starCoins: number,
  happyChanceCards: number,
  points: { snack: number, toy: number, game: number },
  tasks: Task[],                 // お手伝い候補（allTasks相当）
  todayTasks: TodayTask[],
  history: HistoryEntry[],
  payLogs: PayLog[],
  transferHistory: TransferLog[],
  ticketGiftLogs: TicketGiftLog[],
  taskHistory: TaskHistoryEntry[],
  starGiftHistory: string[],
  parentPassword: string,
  parentEmail: string,
  badges: string[],
  audioSettings: AudioSettings,
  lastDailyResetKey: string
}
```

`completedTasks` は独立配列ではなく、`todayTasks` のうち `status` が完了値の項目です。`allTasks` という実フィールドはなく `tasks` が相当します。

## Task

```js
{
  id: string,                    // 初期固定IDまたは task-${Date.now()}
  icon: string,                  // 実質1書記素へ丸める
  title: string,
  difficulty: "easy" | "normal" | "hard",
  ticketReward: number,          // 1..5
  rewardType: "ticket" | "starCoin",
  starCoinReward: number,        // 1..5
  category: "creature" | "cooking" | "laundry" | "cleanup" | "outside",
  status: "idle" | "inProgress" | "done",
  isDefault: boolean
}
```

初期データは6件です。`feed-pet`, `toy-clean`, `laundry-carry`, `wipe-table`, `dish-help`, `vacuum-help` の固定IDを持ちます。現行UIでは `Task.status` より `TodayTask.status` が実際の今日の状態として使われます。

## TodayTask

```js
{
  taskId: string,                // Task.id 参照
  status: "idle" | "inProgress" | "done",
  startedAt: string,             // 現行UIでは通常空文字
  completedAt: string,           // 表示用の日本語日時文字列
  ticketReward: number,          // 追加時スナップショット、完了時にTaskから再取得
  rewardType: "ticket" | "starCoin",
  starCoinReward: number,
  ticketGranted: boolean         // 両報酬共通の付与済みフラグ
}
```

同じ `taskId` の重複追加はUIロジックで防ぎます。午前6時の日次リセットで配列全体が空になります。

## 履歴

### HistoryEntry

共通形は `{ text, type, date, ...details }`。コードで生成される `type` は次の通りです。

- `general`: type省略時の一般操作（追加、キャンセル、ルーレット、PAY使用・振替など）
- `dailyReset`
- `taskCompleted`
- `taskCompletedStarCoin`
- `ticketGift`
- `starCoinGift`
- `starCoinExchange`
- `hapichikeCardEmailShared`

最大40件、先頭が最新です。各typeは任意の追加フィールドを持ちます。

### PayLog

`{ id, payId, label, category, amount, before, after, date }`。PAY使用時に追加し最大50件です。

### TransferLog

`{ id, date, fromId, fromLabel, toId, toLabel, amount }`。最大50件です。

### TicketGiftLog

`{ id, type: "ticketGift", amount, reason, createdAt, date }`。最大50件です。画面では直近8件を表示します。

### TaskHistoryEntry

`{ id, sourceTaskId, title, icon, category, difficulty, ticketReward, rewardType, starCoinReward, lastUsedAt, completedCount }`。`title::category` が重複判定キーで最大80件です。`lastUsedAt` 降順、同値なら `completedCount` 降順です。

### starGiftHistory

40文字以内のメッセージ文字列配列。完全一致重複を除外し、再利用時は先頭へ移動、最大20件です。入力候補表示は最大8件です。

## その他

```js
AudioSettings = {
  bgmEnabled: boolean,           // 初期 true
  sfxEnabled: boolean,           // 初期 true
  bgmVolume: number,             // 初期 0.22、UI変更手段なし
  sfxVolume: number              // 初期 0.62、UI変更手段なし
}
```

- `parentPassword`: 初期 `"1234"`、主状態内に平文保存。
- `parentEmail`: 主状態にも含まれるが、専用キー `kidsVegasCasino.parentEmail.v1` が優先。
- `childName`: 名前だけ。複数プロフィール配列、子どもID、選択中IDはない。Supabase案の`children.id`への対応付けは未実装であり、自動移行してはいけない。
- `backup data`: 未実装のため型なし。
- `happyChanceReserved`, `latestRouletteResult`, `activeCategory`, `activeBet` などはメモリのみで、再読込時に消えます。
- Supabase Auth userは親だけを表す。子どもは`children.id`を持つプロフィールであり、Auth accountではない。
- Supabase `parent_settings`には認証passwordもlocalStorageの`parentPassword`も保存しない。

## サンプル

```json
{
  "childName": "うぱ",
  "coins": 2,
  "starCoins": 1,
  "happyChanceCards": 0,
  "points": { "snack": 4, "toy": 0, "game": 0 },
  "tasks": [{
    "id": "wipe-table", "icon": "✨", "title": "テーブルをふく",
    "difficulty": "normal", "ticketReward": 2, "rewardType": "ticket",
    "starCoinReward": 1, "category": "cooking", "status": "idle", "isDefault": true
  }],
  "todayTasks": [{
    "taskId": "wipe-table", "status": "idle", "startedAt": "", "completedAt": "",
    "ticketReward": 2, "rewardType": "ticket", "starCoinReward": 1, "ticketGranted": false
  }]
}
```
