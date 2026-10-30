# HAPICHIKE sync Phase 2: initial snapshot import

更新日: 2026-10-30

## Import contract

初回importは通常の005加算RPCを使わず、`import_initial_hapichike_snapshot` へ6残高の絶対値snapshotを渡す。対象は `app_id = hapichike`、`import_version = 1` のみ。親設定のクラウド連携UIから、全readiness条件と4項目の明示承認を満たした場合だけ呼び出し、自動実行しない。

必須入力は `child_id`、`import_id`、`import_version`、lowercase SHA-256 `source_snapshot_hash`、6残高、`backup_created_at`、`parent_approved = true`。ticketsと3 PAYは負数を許容し、star coinsとhappy chance cardsは0以上とする。PostgreSQLのinteger引数によりNaN、Infinity、小数は受理しない。

## Sync state

`child_app_sync_state` は `(child_id, app_id)` を主キーとし、初回import ID、完了日時、version、source snapshot hash、作成・更新日時だけを保持する。`app_id` は現段階では `hapichike` に限定する。`(app_id, initial_import_id)` は重複不可。

RLSを有効にし、既存の残高read modelと同様に家庭内のowner、parent、viewerがSELECTできる。`authenticated` の直接INSERT、UPDATE、DELETEは不可で、更新は専用RPCだけが行う。

## Authorization

RPCは `authenticated` にだけEXECUTEを許可する。`auth.uid()` と `household_members` を照合し、対象childと同じ家庭の `owner` または `parent` だけを許可する。viewer、anon、他家庭userは拒否する。household IDは引数で受け取らず、対象childから解決する。

## Parent approval

親によるmapping、比較、backup確認の後にのみ実行する。RPCは `p_parent_approved = true` を必須とし、実行者を監査logの `approved_by` に記録する。子ども用UI、自動同期、Phase 1比較画面には実行経路を接続しない。

## Backup gate

RPCは `p_backup_created_at` を必須とし、未来時刻を拒否する。監査logにも保存する。これは親クライアントが検証済みbackupを作成したという申告を記録するgateであり、DBは端末上のbackupファイル内容や保存完了を完全には証明できない。将来UIではbackup生成・検証結果を確認してからRPCを呼ぶ。

## Snapshot semantics

6残高を差分加算せず、`child_balances` の絶対値として一度に設定する。child行とbalance行をlockし、並行する初回importを直列化する。localStorage、legacy履歴、taskは変更・移行しない。

client-side helper `initial-import-core.js` は固定キー順のcanonical JSONを作成し、Web Crypto SHA-256、UUID、入力validationを含むpreview payloadを生成する。helper自身は送信しない。

## Idempotency

同じ `import_id`、version、source hash、6残高snapshotのretryはno-opで成功し、監査logを増やさない。同じ `import_id` でversion、hash、snapshotのいずれかが異なる場合は拒否する。

別 `import_id` で同じsource hashを送った場合は不審な再importとして明示的に拒否する。別hashでも、初回import完了後の再importは拒否する。監査logに6残高snapshotを保存するため、import後に通常RPCで残高が変化しても元payloadを比較できる。

## Cloud initialized rule

次をすべて満たす場合だけ未初期化と判定する。

- 対象のsync stateが存在しない（中途半端なstateがあれば要手動確認）
- 6残高がすべて0
- 対象childの `reward_logs` が0件

したがって「全残高0」だけではimport可能にしない。既存残高が非0のstaging Child A/Bは `cloud child is already initialized` で拒否される。残高を0へ戻して試験しない。

## Reward audit log

成功時に `reward_logs` へ `type = initial_import` を1件だけ追加する。metadataは `app_id`、`import_id`、`import_version`、`snapshot_hash`、`source = legacy_localstorage`、`backup_created_at`、`approved_by`、6残高 `snapshot` を持つ。legacyの過去明細は移行しない。

## Rollback

balance snapshot設定、sync state作成、監査log追加は1回のRPC transaction内で行う。validation、認可、log insertを含む途中処理が失敗した場合はすべてrollbackされる。local testでは監査logを意図的に失敗させ、3要素が残らないことを検証する。

## Test matrix

`supabase/tests/local_initial_snapshot_import.sql` はtransaction内に専用household、owner、parent、viewer、他家庭user、複数childを作成し、最後にrollbackする。

- owner / parent成功、viewer / anon / 他家庭拒否
- 6残高、sync state、完了日時、version、hash、監査log
- 同一retry、同一ID異payload、別ID再import、同hash別ID
- initialized child、star負数、happy chance負数、親承認、backup gate
- tickets / PAY負数維持、direct sync-state write拒否
- log失敗時のatomic rollback
- 005 RPCとread modelの継続動作

JS unit testはcanonicalization、SHA-256、preview、入力validation、負数仕様を検証する。

## Future Phase 3

Phase 3で検討する対象は、import完了後のcloud正本化、event ID付き通常RPC、offline queue、競合解決である。task同期、history移行、JSON cloud restore、自動同期はPhase 2に含めない。

## Phase 2 UI

親設定の「クラウド連携」に「初回snapshot import」を追加した。画面表示、比較、readiness判定はSELECTだけを使い、登録ボタンの明示操作時だけ `importInitialHapichikeSnapshot` から専用RPCを1回呼ぶ。`child_balances`、`reward_logs`、`child_app_sync_state` をUIから直接書き換えない。

## Readiness gates

Supabase設定、Parent login、現在のhousehold、local child、保存済みmapping、最新backup、local snapshot、cloud balance、sync state、reward logs、owner/parent role、import未完了を表示する。登録直前にもsession、household membership、children一覧、mapping、3種のCloud読取結果を取り直す。Cloud未初期化はsync stateなし、6残高がすべて0、reward logs 0件の全条件で判定し、RPCを最終防御とする。

backup metadataは `kidsVegasCasino.initialImportBackup.v1` に作成日時と6残高のcanonical snapshotだけを保存する。現在の6残高と一致しない古いbackupはgateを通さない。backupファイル本体、認証情報、秘密情報は保存・送信しない。

## Preview

Tickets、Star Coins、SweetsPAY、ToyPAY、GamePAY、Happy Chance CardsのLocal snapshotとCloud currentを並べる。差分は比較専用で、登録値はLocal snapshotの絶対値であることを明記する。

## Parent approval

登録可能な場合だけ、backup作成、対応Child、表示中の6残高、初回登録が1回だけであることの4項目を有効化する。全項目checkedで「このデータを初回クラウド登録する」を有効化する。

## Retry

RPC送信前にUUID、canonical hash、payloadを生成して `kidsVegasCasino.pendingInitialImport.v1` に保存する。network error時だけ同一child、backup、snapshotに対して同じimport IDとpayloadを再利用する。明確なRPC拒否ではpending payloadを破棄し、状態を再確認するまで再実行させない。token、password、Auth sessionは保存しない。

## Success state

成功後はpending metadataを削除し、sync state、balance、reward logs、children/mappingを再取得して表示を更新する。完了済み判定により再importボタンを無効化する。localStorageの主残高キー `kidsVegasCasino.v1` は変更しない。

## Cloud initialized state

sync stateがある、6残高のいずれかが非0、reward logsが1件以上、balance行が欠損、または状態取得が完了していない場合は実行不可とする。既存データを0へ戻す操作は設けない。

## Staging A/B verification

Parent A / Child A、Parent B / Child Bは既存Cloud残高または履歴により `Cloud already initialized` となる想定で、登録ボタンは無効、RPC実行0件を正とする。成功importは行わず、残高、reward logs、sync stateを変更しない。

2026-10-30にVercelの独立した `hapichike-staging` プロジェクトへdeployし、配信HTMLと最終JSの反映をread-only確認した。initialized済みA/B相当のunit testでは両方ともbutton実行判定false、RPC call count 0。Parent A/Bの実ブラウザ確認は、Windows Computer Useが現在URLを安全に特定できず停止したため未実施で、手動ログイン確認が残る。

## Child C test prerequisites

成功系staging試験は新規Child Cを用意し、同一householdのownerまたはparent、balance行ありかつ6残高0、reward logs 0件、sync stateなし、有効mapping、現在snapshotと一致するbackup、4項目承認を満たしてから行う。Child A/Bのresetや履歴削除で代用しない。
