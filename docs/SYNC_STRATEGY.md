# Synchronization and migration strategy

## Current policy

- localStorage (`kidsVegasCasino.v1` and the parent-email key) remains the sole source of truth.
- Supabase is optional groundwork for a later parent screen and multi-device support.
- No automatic upload, download, merge, deletion, or overwrite is performed in this change.
- If Supabase is unconfigured, the app works in localStorage-only mode.

## Future opt-in migration

1. Parent authenticates and selects/creates a household.
2. The app exports and requires the parent to save a validated JSON backup first. JSONバックアップの作成・検証が完了するまでSupabaseへのデータ移行を開始してはいけない。
3. The parent reviews the current single-profile data and explicitly creates/selects the target child profile.
4. The app shows a mapping and conflict preview before any remote write.
5. A confirmed migration writes an audit log and records completion metadata without deleting local data.
6. Parent verifies remote data before choosing any later sync mode.

## Conflict and safety rules

- Do not silently resolve two-device conflicts. Surface timestamp/source details to the parent.
- Balance/reward mutations need server-side transactional RPCs; client-side read-modify-write is not safe.
- RLS isolates all rows by household. The frontend uses only an anon key; service-role credentials remain server-side only.
- Preserve original local keys until a separate, explicit deprecation plan with restore testing is approved.

## Known prerequisite

Child data is not currently separated: `childName` is a display label and the balances, tasks, and histories are shared. A stable `childId` and selected-child model must be designed before full migration or synchronization.

Supabase schema/RLS/RPC migrationは作成済みだがremote未適用で、現行UIにも未接続。DBの受け皿が存在しても、この方針による明示的なbackup・確認・opt-inなしにlocalStorageを読み書きまたは同期しない。
