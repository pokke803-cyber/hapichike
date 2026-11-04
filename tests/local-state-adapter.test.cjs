const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("../src/child-identity-core.js");
const adapter = require("../src/local-state-adapter.js");
const mapping = require("../src/cloud-mapping-core.js");

const A = "11111111-1111-4111-8111-111111111111";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-11-04T00:00:00.000Z";

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.failKey = null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { if (this.failKey === key) throw new Error("failure"); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function profile(key, name, tickets) {
  const value = identity.createProfileData({ localChildKey: key, childName: name }, { now: () => new Date(NOW) });
  value.coins = tickets;
  return value;
}

function setup() {
  const store = identity.createEmptyStore(NOW);
  store.profiles[A] = profile(A, "Child A", 1);
  store.profiles[C] = profile(C, "Child C", 9);
  store.activeLocalChildKey = A;
  store.householdShared.taskMaster = [{ id: "shared", title: "Shared task" }];
  store.identityMigrations = [{ migrationVersion: 1, migratedAt: NOW, source: "legacy-single-profile", targetLocalChildKey: A, sourceHash: "a".repeat(64) }];
  const legacy = { childName: "Legacy", coins: 99, tasks: [], parentPassword: "2468", audioSettings: { bgmEnabled: true, sfxEnabled: true, bgmVolume: .2, sfxVolume: .6 } };
  return new MemoryStorage({ [adapter.V1_KEY]: JSON.stringify(legacy), [adapter.V2_KEY]: JSON.stringify(store) });
}

test("activated v2はactive profileをSource of Truthにしv1へwriteしない", () => {
  const storage = setup();
  const v1 = storage.getItem(adapter.V1_KEY);
  const loaded = adapter.load(storage);
  assert.equal(loaded.mode, "v2");
  assert.equal(loaded.state.childName, "Child A");
  assert.equal(loaded.state.coins, 1);
  assert.deepEqual(loaded.state.tasks, [{ id: "shared", title: "Shared task" }]);
  loaded.state.coins += 1;
  adapter.save(storage, loaded.state, NOW);
  assert.equal(storage.getItem(adapter.V1_KEY), v1);
  assert.equal(JSON.parse(storage.getItem(adapter.V2_KEY)).profiles[A].coins, 2);
});

test("A/Cの6残高・task・history・progress・resetは完全分離", () => {
  const storage = setup();
  const stateA = adapter.load(storage).state;
  Object.assign(stateA, { coins: 2, starCoins: 3, happyChanceCards: 4, points: { snack: 5, toy: 6, game: 7 }, todayTasks: [{ taskId: "a" }], history: [{ text: "A" }], badges: ["A"], lastDailyResetKey: "A" });
  adapter.save(storage, stateA, NOW);
  adapter.switchActive(storage, C, NOW);
  const stateC = adapter.load(storage).state;
  assert.deepEqual([stateC.coins, stateC.starCoins, stateC.happyChanceCards, stateC.points.snack], [9, 0, 0, 0]);
  assert.deepEqual([stateC.todayTasks, stateC.history, stateC.badges, stateC.lastDailyResetKey], [[], [], [], ""]);
  stateC.coins += 1;
  stateC.starCoins = 8;
  adapter.save(storage, stateC, NOW);
  const root = JSON.parse(storage.getItem(adapter.V2_KEY));
  assert.deepEqual([root.profiles[A].coins, root.profiles[C].coins], [2, 10]);
  assert.deepEqual([root.profiles[A].starCoins, root.profiles[C].starCoins], [3, 8]);
});

test("selectorはUUIDで切替え、invalid keyを拒否しreload後もactiveを保持", () => {
  const storage = setup();
  assert.deepEqual(adapter.listProfiles(storage).map(item => [item.childName, item.active]), [["Child A", true], ["Child C", false]]);
  adapter.switchActive(storage, C, NOW);
  assert.equal(adapter.load(storage).store.activeLocalChildKey, C);
  assert.equal(adapter.load(storage).state.childName, "Child C");
  assert.throws(() => adapter.switchActive(storage, "Child A"), /UUID/);
});

test("名前変更でもUUIDは不変、task masterだけsharedへ保存", () => {
  const storage = setup();
  const state = adapter.load(storage).state;
  state.childName = "Renamed";
  state.tasks.push({ id: "new", title: "New" });
  adapter.save(storage, state, NOW);
  const root = JSON.parse(storage.getItem(adapter.V2_KEY));
  assert.equal(root.profiles[A].localChildKey, A);
  assert.equal(root.profiles[A].childName, "Renamed");
  assert.deepEqual(root.profiles[A].tasks, []);
  assert.equal(root.householdShared.taskMaster.length, 2);
});

test("legacy未移行はv1互換、activated invalid/missing activeはfail closed", () => {
  const legacy = { childName: "Legacy", tasks: [], coins: 3 };
  const storage = new MemoryStorage({ [adapter.V1_KEY]: JSON.stringify(legacy) });
  assert.equal(adapter.load(storage).mode, "legacy");
  assert.equal(adapter.load(storage).state.coins, 3);
  storage.setItem(adapter.ACTIVATION_KEY, "active");
  assert.throws(() => adapter.load(storage), /V2_FAIL_CLOSED/);
  storage.setItem(adapter.V2_KEY, "{broken");
  assert.throws(() => adapter.load(storage), /V2_FAIL_CLOSED/);
  const invalid = identity.createEmptyStore(NOW);
  storage.setItem(adapter.V2_KEY, JSON.stringify(invalid));
  assert.throws(() => adapter.load(storage), /ACTIVE_CHILD_MISSING/);
});

test("safe write失敗はv2/device/activationをまとめてrollback", () => {
  const storage = setup();
  const before = new Map(storage.values);
  const state = adapter.load(storage).state;
  state.coins = 50;
  storage.failKey = adapter.DEVICE_SETTINGS_KEY;
  assert.throws(() => adapter.save(storage, state), /previous data was restored/);
  assert.deepEqual(storage.values, before);
});

test("reward resolverはactive UUID→mapping→child_idを解決しmissing/duplicate/household/staleを拒否", () => {
  const storage = setup();
  assert.equal(adapter.resolveRewardChild(storage).reason, "MAPPING_MISSING");
  storage.setItem(mapping.MAPPING_V2_STORAGE_KEY, JSON.stringify({ appId: "hapichike", version: 2, mappings: [
    { localChildKey: A, supabaseChildId: "cloud-a", householdId: "home-a", confirmedAt: NOW },
  ] }));
  assert.deepEqual(adapter.resolveRewardChild(storage, { householdId: "home-a", visibleChildren: [{ id: "cloud-a", householdId: "home-a" }] }), {
    mode: "cloud", cloudReady: true, localChildKey: A, supabaseChildId: "cloud-a", householdId: "home-a",
  });
  assert.equal(adapter.resolveRewardChild(storage, { householdId: "home-b" }).reason, "HOUSEHOLD_MISMATCH");
  assert.equal(adapter.resolveRewardChild(storage, { householdId: "home-a", visibleChildren: [] }).reason, "MAPPING_STALE");
  storage.setItem(mapping.MAPPING_V2_STORAGE_KEY, JSON.stringify({ appId: "hapichike", version: 2, mappings: [
    { localChildKey: A, supabaseChildId: "cloud-a", householdId: "home-a", confirmedAt: NOW },
    { localChildKey: C, supabaseChildId: "cloud-a", householdId: "home-a", confirmedAt: NOW },
  ] }));
  assert.equal(adapter.resolveRewardChild(storage).reason, "MAPPING_INVALID");
});

test("Local Child切替コードはParent viewed identityを書き換えない", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require("node:path").join(__dirname, "../src/local-state-adapter.js"), "utf8");
  assert.doesNotMatch(source, /parentViewedSupabaseChildId|localStorage\.clear|\.rpc\s*\(|supabase\.from/i);
});
