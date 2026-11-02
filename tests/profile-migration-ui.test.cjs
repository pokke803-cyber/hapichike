const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ui = require("../src/profile-migration-ui-core.js");
const migration = require("../src/profile-migration.js");

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.writes = 0; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.writes += 1; this.values.set(key, String(value)); }
  removeItem(key) { this.writes += 1; this.values.delete(key); }
}

function legacy() {
  return {
    childName: "旧名", coins: 3, starCoins: 1, happyChanceCards: 0,
    points: { snack: 2, toy: 0, game: 4 }, tasks: [],
    todayTasks: [{ taskId: "a", status: "done" }, { taskId: "b", status: "idle" }],
    history: [{ text: "x" }], parentPassword: "secret",
  };
}

test("legacy summary inspection is read-only and includes required source summary", () => {
  const storage = new MemoryStorage({ [migration.V1_KEY]: JSON.stringify(legacy()) });
  const summary = migration.inspectLegacyMigration(storage);
  assert.equal(storage.writes, 0);
  assert.equal(summary.sourceChildName, "旧名");
  assert.deepEqual(summary.balances, { tickets: 3, starCoins: 1, sweetsPay: 2, toyPay: 0, gamePay: 4, happyChanceCards: 0 });
  assert.deepEqual(summary.todayTasks, { count: 2, completed: 1, pending: 1 });
  assert.equal(summary.historyCount, 1);
  assert.equal(summary.migrated, false);
});

test("balance comparison reports match and mismatch without mutation", () => {
  const local = { tickets: 3, starCoins: 1, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0 };
  const cloud = { tickets: 3, star_coins: 0, sweets_pay: 0, toy_pay: 0, game_pay: 0, happy_chance_cards: 0 };
  const rows = ui.compareBalances(local, cloud);
  assert.equal(rows.length, 6);
  assert.equal(rows.find(row => row.key === "tickets").matches, true);
  assert.equal(rows.find(row => row.key === "starCoins").matches, false);
  assert.deepEqual(local, { tickets: 3, starCoins: 1, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0 });
});

test("backup balance mapping uses phase 0/2 snake case snapshot", () => {
  assert.deepEqual(ui.backupBalances({ tickets: 1, starCoins: 2, sweetsPay: 3, toyPay: 4, gamePay: 5, happyChanceCards: 6 }), {
    tickets: 1, star_coins: 2, sweets_pay: 3, toy_pay: 4, game_pay: 5, happy_chance_cards: 6,
  });
});

test("apply guard requires selection, current backup, preview and all approvals", () => {
  const ready = {
    sourceValid: true, selectedChildValid: true, previewCanApply: true, backupCurrent: true,
    approvals: { owner: true, backup: true, preview: true, cloudUnchanged: true }, applying: false, completed: false,
  };
  assert.equal(ui.canApply(ready), true);
  for (const key of ["sourceValid", "selectedChildValid", "previewCanApply", "backupCurrent"]) {
    assert.equal(ui.canApply({ ...ready, [key]: false }), false);
  }
  for (const key of ["owner", "backup", "preview", "cloudUnchanged"]) {
    assert.equal(ui.canApply({ ...ready, approvals: { ...ready.approvals, [key]: false } }), false);
  }
  assert.equal(ui.canApply({ ...ready, applying: true }), false);
  assert.equal(ui.canApply({ ...ready, completed: true }), false);
});

test("migration errors are converted to safe parent-facing messages", () => {
  assert.match(ui.safeError(new Error("backup missing")), /バックアップ/);
  assert.match(ui.safeError(new Error("source state changed")), /元データ/);
  assert.match(ui.safeError(new Error("householdShared conflicts require parent resolution")), /競合/);
  assert.match(ui.safeError(new Error("migration failed; previous v2 was restored: write")), /戻しました/);
  assert.doesNotMatch(ui.safeError(new Error("internal stack at secret.js:12")), /stack|secret\.js/);
});

test("UI is explicitly wired as local migration with read-only cloud calls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/profile-migration-ui.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /子どもデータの移行/);
  assert.match(html, /この端末に保存されている現在のデータは誰のものですか/);
  assert.match(source, /previewLegacyMigration/);
  assert.match(source, /applyLegacyMigration/);
  assert.match(source, /getChildBalances/);
  assert.match(source, /getChildrenByHousehold/);
  assert.doesNotMatch(source, /saveMapping|importInitialHapichikeSnapshot|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});

test("page load only registers migration UI and does not open or apply it", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/profile-migration-ui.js"), "utf8");
  assert.match(source, /addEventListener\("hapichike:open-profile-migration", openPanel\)/);
  assert.doesNotMatch(source, /window\.addEventListener\("load"[^)]*openPanel/);
  assert.doesNotMatch(source, /DOMContentLoaded[^\n]*openPanel/);
  assert.equal((source.match(/migration\.applyLegacyMigration\(/g) || []).length, 1);
});
