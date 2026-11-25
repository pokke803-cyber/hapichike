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

test("データ管理は取得元・取得時刻・限定同期warning・初回import手順を表示する", () => {
  assert.match(html, /id="localSourceMeta"/);
  assert.match(html, /id="cloudSourceMeta"/);
  assert.match(html, /タスク、今日の状態、全履歴、設定が同期済みになるわけではありません/);
  assert.match(html, /class="step-guide"/);
  assert.match(js, /初回import済み（6残高snapshotのみ）/);
  assert.match(js, /自動再送はしません/);
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
