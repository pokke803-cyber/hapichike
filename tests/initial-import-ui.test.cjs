const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ui = fs.readFileSync(path.join(root, "src", "cloud-mapping-ui.js"), "utf8");
const rewardsApi = fs.readFileSync(path.join(root, "src", "services", "api", "rewardsApi.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const parentIndex = fs.readFileSync(path.join(root, "parent", "index.html"), "utf8");

test("初回import UIはread-only情報を取得し、専用RPC wrapperだけを使う", () => {
  assert.match(ui, /getChildBalances/);
  assert.match(ui, /getChildAppSyncState/);
  assert.match(ui, /getRewardLogs/);
  assert.match(ui, /importInitialHapichikeSnapshot\(preview\)/);
  assert.doesNotMatch(ui, /\.from\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/);
  assert.match(rewardsApi, /rewardRpc\("import_initial_hapichike_snapshot"/);
});

test("page load/openはRPCを実行せず、実行ボタンのclick handlerだけがimport経路を持つ", () => {
  const openPanel = ui.slice(ui.indexOf("async function openPanel"), ui.indexOf("function safeImportError"));
  assert.doesNotMatch(openPanel, /importInitialHapichikeSnapshot/);
  assert.match(ui, /importButton\?\.addEventListener\("click", executeInitialImport\)/);
  assert.match(ui, /if \(state\.importing\) return/);
});

test("UIは6残高preview、warning、4承認、Cloud initialized理由を表示する", () => {
  assert.match(index, /初回移行は1回だけ実行できます/);
  assert.match(index, /クラウド側の既存残高または履歴がある場合は実行できません/);
  assert.match(index, /approveCloudBackup/);
  assert.match(index, /approveCloudMapping/);
  assert.match(index, /approveCloudSnapshot/);
  assert.match(index, /approveCloudOneTime/);
  assert.match(index, /初回登録は1回だけであることを理解しました/);
  assert.match(ui, /すでにクラウド側で初期化されています/);
  assert.match(ui, /Local snapshot/);
  assert.match(ui, /絶対値/);
});

test("実行直前にsession・household・children・mappingとCloud状態を再確認する", () => {
  const preflight = ui.slice(ui.indexOf("async function refreshImportPreflight"), ui.indexOf("async function executeInitialImport"));
  assert.match(preflight, /getParentSession/);
  assert.match(preflight, /getCurrentHouseholds/);
  assert.match(preflight, /getChildrenByHousehold/);
  assert.match(preflight, /findVerifiedMapping/);
  assert.match(preflight, /getChildBalances/);
  assert.match(preflight, /getChildAppSyncState/);
  assert.match(preflight, /getRewardLogs/);
});

test("network errorだけ再試行を許可し、明確なRPC拒否後は再押下を止める", () => {
  assert.match(ui, /retryable: true/);
  assert.match(ui, /state\.rpcRejected = !safeError\.retryable/);
  assert.match(ui, /同じ内容で再試行/);
  assert.match(ui, /\|\| state\.rpcRejected/);
});

test("成功後にsync state・balance・reward_logsを再取得する", () => {
  const start = ui.indexOf("async function executeInitialImport");
  const execute = ui.slice(start, ui.indexOf("view.household?.addEventListener", start));
  assert.match(execute, /await importInitialHapichikeSnapshot\(preview\)/);
  assert.match(execute, /await renderComparison\(\)/);
  assert.match(execute, /初回データ登録が完了しました/);
});

test("localStorage主残高keyへ書き込まず、許可されたmetadata helperだけを使う", () => {
  assert.doesNotMatch(ui, /kidsVegasCasino\.v1/);
  assert.match(ui, /savePendingPreview/);
  assert.match(index, /recordBackupMetadata/);
});

test("親ダッシュボードから既存のクラウド連携パネルへ辿れる", () => {
  assert.match(parentIndex, /href="\/#parent-cloud"/);
  assert.match(parentIndex, /Local \/ Cloud比較・初回登録状態を確認/);
  assert.match(index, /window\.location\.hash === "#parent-cloud"/);
  assert.match(index, /if \(openCloudMappingAfterParentUnlock\) openParentSettings\(\)/);
  assert.match(index, /openCloudMapping\(\)/);
});
