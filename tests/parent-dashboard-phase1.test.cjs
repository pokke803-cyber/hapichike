const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "parent", "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "parent", "parent.js"), "utf8");
const css = fs.readFileSync(path.join(root, "parent", "parent.css"), "utf8");

test("親画面はホーム・データ管理・設定の3タブに分離する", () => {
  for (const [tab, panel] of [["home", "homePanel"], ["data", "dataPanel"], ["settings", "settingsPanel"]]) {
    assert.match(html, new RegExp(`data-dashboard-tab="${tab}"`));
    assert.match(html, new RegExp(`id="${panel}"`));
  }
  assert.match(js, /function setActiveDashboardTab/);
});

test("ホームは選択・6残高・履歴・Cloud状態とsame-origin子どもアプリ導線を持つ", () => {
  assert.match(html, /id="childTabs"/);
  assert.match(html, /id="balanceGrid"/);
  assert.match(html, /id="choresList"/);
  assert.match(html, /id="logsList"/);
  assert.match(html, /id="homeCloudStatus"/);
  assert.match(html, /id="openChildAppLink"[^>]+href="\/"/);
  assert.doesNotMatch(html, /openChildAppLink[^>]+(?:token|session|access_token)/i);
});

test("データ管理は取得元・取得時刻・限定保存warning・5ステップガイドを表示する", () => {
  assert.match(html, /id="localSourceMeta"/);
  assert.match(html, /id="cloudSourceMeta"/);
  assert.match(html, /タスク、今日の項目、全履歴、設定は完全同期されません/);
  assert.equal((html.match(/data-wizard-step="[1-5]"/g) || []).length, 5);
  assert.match(html, /id="startInitialSaveButton"/);
  assert.match(html, /id="backupRestoreDetails"/);
  assert.match(html, /id="advancedSettingsDetails"/);
  assert.match(js, /クラウドへの初回保存済み（6残高のみ）/);
  assert.match(js, /自動再送はしません/);
});

test("初回保存ガイドは子ども切替・通信結果不明・再取得確認を安全側に扱う", () => {
  assert.match(js, /initialSaveContext/);
  assert.match(js, /resetInitialSaveGuide\(\{ close: true \}\)/);
  assert.match(js, /確認前の再送は禁止/);
  assert.match(js, /refreshAndEvaluateImport/);
  assert.match(js, /viewedChildSyncState\?\.initial_import_completed_at/);
  assert.match(js, /balancesMatchCloud/);
  assert.match(js, /Boolean\(importResult\) \|\| !globalThis\.HapichikeParentCloudActions\.canExecuteImport/);
  assert.match(js, /readiness\.checks\.cloudUninitialized/);
  assert.match(js, /クラウドの残高・履歴・初回保存状態を確定できません/);
  assert.match(js, /elements\.backupFileConfirmed\.checked/);
  assert.match(js, /resetActionPreviews\(\)/);
  assert.match(js, /setActionMessage\(elements\.backupActionMessage, ""\)/);
  assert.match(html, /id="backupFileReason"/);
  assert.match(html, /id="importApprovalsReason"/);
});

test("設定はCloud Child追加・家庭account・折りたたみdiagnosticを持つ", () => {
  assert.match(html, /id="settingsPanel"[\s\S]*id="showChildCreateButton"/);
  assert.match(html, /id="settingsAccountEmail"/);
  assert.match(html, /id="settingsHouseholdName"/);
  assert.match(html, /<details class="settings-details">/);
  assert.match(html, /id="diagnosticGrid"/);
});

test("スマホ・タブレット幅のresponsive rulesと大きな主要操作を維持する", () => {
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.dashboard-tab[\s\S]*min-height: 50px/);
  assert.match(css, /\.child-app-button[\s\S]*min-height: 58px/);
});
