const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/online-rewards-core.js");

const mapping = { supabaseChildId: "child-c", householdId: "house-a" };
const session = { user: { id: "parent-a" } };

function ready(overrides = {}) {
  return {
    mapping,
    session,
    networkAvailable: true,
    householdValid: true,
    childVisible: true,
    syncStateLoaded: true,
    syncState: { app_id: "hapichike", initial_import_completed_at: "2026-10-31T00:00:00.000Z" },
    ...overrides,
  };
}

test("mappingなしとinitial import未完了はlocal-only", () => {
  assert.equal(core.evaluateCloudReady(ready({ mapping: null })).mode, "local");
  assert.equal(core.evaluateCloudReady(ready({ syncState: null })).mode, "local");
  assert.equal(core.evaluateCloudReady(ready({ syncState: { app_id: "hapichike", initial_import_completed_at: null } })).mode, "local");
});

test("Cloud-readyはlogin・household・mapping・hapichike import完了を要求", () => {
  assert.deepEqual(core.evaluateCloudReady(ready()), { mode: "cloud", reason: "ready", childId: "child-c" });
  assert.equal(core.evaluateCloudReady(ready({ session: null })).reason, "session_missing");
  assert.equal(core.evaluateCloudReady(ready({ networkAvailable: false })).reason, "offline");
  assert.equal(core.evaluateCloudReady(ready({ householdValid: false })).reason, "household_invalid");
  assert.equal(core.evaluateCloudReady(ready({ childVisible: false })).reason, "mapping_invalid");
  assert.equal(core.evaluateCloudReady(ready({ syncState: { app_id: "other", initial_import_completed_at: "x" } })).mode, "local");
});

test("ticket/star/PAY/happy eventに意味情報を保持", () => {
  const now = () => new Date("2026-11-01T00:00:00.000Z");
  for (const event of [
    { type: "ticket", amount: 1 },
    { type: "star_coin", amount: -1 },
    { type: "star_exchange", amount: 1 },
    { type: "pay", category: "sweets", amount: 1 },
    { type: "happy_chance", amount: -1 },
  ]) {
    const actual = core.createRewardEvent({ ...event, child_id: "child-c", source: "test" }, now);
    assert.equal(actual.child_id, "child-c");
    assert.equal(actual.source, "test");
    assert.equal(actual.created_at, "2026-11-01T00:00:00.000Z");
  }
  assert.throws(() => core.createRewardEvent({ type: "pay", category: "snack", amount: 1, child_id: "c" }), /category/);
});

test("server resultを既存localStorage schemaの6残高へ反映", () => {
  const state = { coins: 99, starCoins: 99, happyChanceCards: 99, points: { snack: 99, toy: 99, game: 99 }, tasks: [1] };
  core.applyServerBalance(state, {
    tickets: 4, star_coins: 2, sweets_pay: 1, toy_pay: 3, game_pay: 5, happy_chance_cards: 1,
  });
  assert.deepEqual(state, { coins: 4, starCoins: 2, happyChanceCards: 1, points: { snack: 1, toy: 3, game: 5 }, tasks: [1] });
});

test("同じactionの並列送信を拒否し、失敗後は再操作可能", async () => {
  let release;
  const pending = core.withActionLock("ticket", () => new Promise(resolve => { release = resolve; }));
  assert.deepEqual(await core.withActionLock("ticket", async () => "second"), { duplicate: true });
  release("first");
  assert.equal(await pending, "first");
  await assert.rejects(() => core.withActionLock("ticket", async () => { throw new Error("rpc failed"); }), /rpc failed/);
  assert.equal(await core.withActionLock("ticket", async () => "retry"), "retry");
});

test("browser bridgeは005 wrapperのみを使い直接table更新しない", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/online-rewards.js"), "utf8");
  for (const name of ["addTicket", "addStarCoin", "exchangeStarCoinsForTicket", "adjustPayBalance", "adjustHappyChance"]) {
    assert.match(source, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(source, /from\(["']child_balances["']\).*update|from\(["']reward_logs["']\).*insert/s);
});

test("initial import実装は変更せず通常同期と別系統", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/online-rewards.js"), "utf8");
  assert.doesNotMatch(source, /importInitialHapichikeSnapshot|pendingInitialImport|source_snapshot_hash/);
});
