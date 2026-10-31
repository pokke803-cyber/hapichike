const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("../src/child-identity-core.js");
const domain = require("../src/profile-domain.js");
const { createRepository } = require("../src/profile-repository.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-11-01T03:00:00.000Z";

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.corruptNextV2Write = false; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.values.set(key, key === identity.STORAGE_KEY && this.corruptNextV2Write ? "{broken" : String(value));
    this.corruptNextV2Write = false;
  }
  removeItem(key) { this.values.delete(key); }
}

function repository(storage = new MemoryStorage()) {
  let index = 0;
  const ids = [UUID_A, UUID_C];
  return createRepository(storage, {
    cryptoApi: { randomUUID: () => ids[index++] },
    now: () => new Date(NOW),
  });
}

test("default profile domainは6残高・task・history・progress・resetが空", () => {
  const repo = repository();
  const profile = repo.createProfile({ childName: "A" });
  assert.deepEqual(domain.getBalances(profile), {
    tickets: 0, starCoins: 0, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0,
  });
  assert.deepEqual(domain.getChildTasks(profile), { assignments: [] });
  assert.deepEqual(domain.getChildHistory(profile), {
    rewardLog: [], payUsage: [], payTransfers: [], ticketGifts: [], completedTasks: [], thankYouStarMessages: [],
  });
  assert.deepEqual(domain.getProgress(profile), { badges: [] });
  assert.deepEqual(domain.getResetState(profile), { lastDailyResetKey: "" });
});

test("6 balance mappingを一箇所で定義しprofileへ安全に反映する", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(domain.BALANCE_MAPPING).map(([key, value]) => [key, value.v1])), {
    tickets: "coins", starCoins: "starCoins", sweetsPay: "points.snack", toyPay: "points.toy",
    gamePay: "points.game", happyChanceCards: "happyChanceCards",
  });
  const profile = identity.createProfileData({ localChildKey: UUID_A }, { now: () => new Date(NOW) });
  const next = domain.setBalances(profile, { tickets: 1, starCoins: 2, sweetsPay: 3, toyPay: 4, gamePay: 5, happyChanceCards: 6 });
  assert.deepEqual(domain.getBalances(next), { tickets: 1, starCoins: 2, sweetsPay: 3, toyPay: 4, gamePay: 5, happyChanceCards: 6 });
  assert.deepEqual(domain.getBalances(profile), { tickets: 0, starCoins: 0, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0 });
});

test("A/Cのbalances tasks history progress reset stateは相互に分離される", () => {
  const repo = repository();
  const a = repo.createProfile({ childName: "A" });
  const c = repo.createProfile({ childName: "C" });
  repo.setBalances(a.localChildKey, { tickets: 9 });
  repo.updateChildTasks(a.localChildKey, { assignments: [{ taskId: "dish", status: "idle" }] });
  repo.appendChildHistory(a.localChildKey, "rewardLog", { type: "roulette", text: "+1" });
  repo.updateProgress(a.localChildKey, { badges: ["first"] });
  repo.updateResetState(a.localChildKey, { lastDailyResetKey: "2026-11-01" });
  const untouchedC = repo.getProfile(c.localChildKey);
  assert.equal(domain.getBalances(untouchedC).tickets, 0);
  assert.deepEqual(domain.getChildTasks(untouchedC).assignments, []);
  assert.deepEqual(domain.getChildHistory(untouchedC).rewardLog, []);
  assert.deepEqual(domain.getProgress(untouchedC).badges, []);
  assert.equal(domain.getResetState(untouchedC).lastDailyResetKey, "");
  repo.setBalances(c.localChildKey, { gamePay: 7 });
  assert.equal(domain.getBalances(repo.getProfile(a.localChildKey)).gamePay, 0);
});

test("householdShared更新はprofilesを変更せず、取得値の破壊的変更も保存へ漏れない", () => {
  const repo = repository();
  const a = repo.createProfile({ childName: "A" });
  const before = repo.getProfile(a.localChildKey);
  repo.updateHouseholdShared({ taskMaster: [{ id: "dish", title: "皿洗い" }] });
  assert.deepEqual(repo.getProfile(a.localChildKey), before);
  const shared = repo.getHouseholdShared();
  shared.taskMaster[0].title = "mutated";
  assert.equal(repo.getHouseholdShared().taskMaster[0].title, "皿洗い");
});

test("childName変更でもlocalChildKeyは不変", () => {
  const repo = repository();
  const a = repo.createProfile({ childName: "A" });
  assert.equal(repo.updateProfile(a.localChildKey, { childName: "改名" }).localChildKey, UUID_A);
});

test("malformed task/history、非有限数、dangerous keyを拒否する", () => {
  const profile = identity.createProfileData({ localChildKey: UUID_A }, { now: () => new Date(NOW) });
  assert.throws(() => domain.updateChildTasks(profile, { assignments: ["bad"] }), /must be an object/);
  assert.throws(() => domain.appendChildHistory(profile, "rewardLog", "bad"), /must be an object/);
  assert.throws(() => domain.setBalances(profile, { tickets: Infinity }), /finite/);
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => domain.updateChildTasks(profile, dangerous), /dangerous key/);
  const store = identity.createEmptyStore(NOW);
  assert.throws(() => identity.validateHouseholdShared({ ...store.householdShared, parentSettings: { parentPassword: "secret" } }), /forbidden secret/);
  assert.throws(() => identity.validateProfile({ ...profile, history: [{ access_token: "secret" }] }, UUID_A), /forbidden secret/);
});

test("householdSharedのsafe write失敗時は以前のv2へrollbackする", () => {
  const storage = new MemoryStorage();
  const repo = repository(storage);
  repo.createProfile({ childName: "A" });
  const before = storage.getItem(identity.STORAGE_KEY);
  storage.corruptNextV2Write = true;
  assert.throws(() => repo.updateHouseholdShared({ taskMaster: [{ id: "x" }] }), /previous data was restored/);
  assert.equal(storage.getItem(identity.STORAGE_KEY), before);
});

test("unknown legacy fieldはlegacyExtras方針で保持でき、v1 rawはbyte-equivalent", () => {
  const legacyRaw = '{"childName":"A","future":{"x":1}}';
  const storage = new MemoryStorage({ "kidsVegasCasino.v1": legacyRaw });
  const repo = repository(storage);
  repo.updateHouseholdShared({ legacyExtras: { future: { x: 1 } } });
  assert.deepEqual(repo.getHouseholdShared().legacyExtras, { future: { x: 1 } });
  assert.equal(storage.getItem("kidsVegasCasino.v1"), legacyRaw);
});

test("Phase 2.5AのhouseholdShared空objectも読み込み互換", () => {
  const profile = identity.createProfileData({ localChildKey: UUID_A }, { now: () => new Date(NOW) });
  const oldStore = { version: 2, appId: "hapichike", activeLocalChildKey: UUID_A, profiles: { [UUID_A]: profile }, householdShared: {}, updatedAt: NOW };
  assert.equal(identity.parseStore(JSON.stringify(oldStore)).profiles[UUID_A].childName, "");
});
