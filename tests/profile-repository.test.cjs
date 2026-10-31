const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const identity = require("../src/child-identity-core.js");
const { createRepository } = require("../src/profile-repository.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIXED_NOW = "2026-11-01T03:00:00.000Z";
const V1_KEY = "kidsVegasCasino.v1";
const MAPPING_V1_KEY = "kidsVegasCasino.cloudMapping.v1";

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.writes = [];
    this.removes = [];
    this.clearCalls = 0;
    this.corruptNextV2Write = false;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.writes.push([key, String(value)]);
    if (key === identity.STORAGE_KEY && this.corruptNextV2Write) {
      this.corruptNextV2Write = false;
      this.values.set(key, "{corrupted-readback");
      return;
    }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.removes.push(key); this.values.delete(key); }
  clear() { this.clearCalls += 1; this.values.clear(); }
}

function cryptoSequence(values) {
  let index = 0;
  return { randomUUID: () => values[index++] ?? values[values.length - 1] };
}

function repository(storage = new MemoryStorage(), uuids = [UUID_A, UUID_C]) {
  return createRepository(storage, {
    cryptoApi: cryptoSequence(uuids),
    now: () => new Date(FIXED_NOW),
  });
}

test("UUID v4でprofileを作成し、v2既定値だけを保存する", () => {
  const storage = new MemoryStorage();
  const repo = repository(storage);
  const profile = repo.createProfile({ childName: "A" });
  assert.equal(profile.localChildKey, UUID_A);
  assert.equal(profile.childName, "A");
  assert.equal(profile.coins, 0);
  assert.deepEqual(profile.points, { snack: 0, toy: 0, game: 0 });
  assert.equal(profile.createdAt, FIXED_NOW);
  const root = JSON.parse(storage.getItem(identity.STORAGE_KEY));
  assert.equal(root.version, 2);
  assert.equal(root.appId, "hapichike");
  assert.equal(root.activeLocalChildKey, null);
  assert.deepEqual(root.householdShared, identity.createDefaultHouseholdShared());
});

test("名前変更でもlocalChildKeyとcreatedAtは変わらない", () => {
  const repo = repository();
  const original = repo.createProfile({ childName: "A" });
  const updated = repo.updateProfile(original.localChildKey, { childName: "新しい名前" });
  assert.equal(updated.localChildKey, original.localChildKey);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.childName, "新しい名前");
  assert.throws(() => repo.updateProfile(original.localChildKey, { localChildKey: UUID_C }), /cannot be changed/);
});

test("2 profileが共存し、A更新でCの全残高が変わらない", () => {
  const repo = repository();
  const a = repo.createProfile({ childName: "A" });
  const c = repo.createProfile({ childName: "C" });
  repo.updateProfile(a.localChildKey, {
    coins: 3,
    starCoins: 1,
    happyChanceCards: 2,
    points: { snack: 4, toy: 5, game: 6 },
  });
  repo.updateProfile(c.localChildKey, {
    coins: 10,
    starCoins: 11,
    happyChanceCards: 12,
    points: { snack: 13, toy: 14, game: 15 },
  });

  repo.updateProfile(a.localChildKey, {
    coins: 4,
    starCoins: 2,
    happyChanceCards: 3,
    points: { snack: 5, toy: 6, game: 7 },
  });

  const profiles = repo.getAllProfiles();
  assert.equal(profiles.length, 2);
  assert.deepEqual(repo.getProfile(a.localChildKey).points, { snack: 5, toy: 6, game: 7 });
  assert.deepEqual(
    {
      coins: repo.getProfile(c.localChildKey).coins,
      starCoins: repo.getProfile(c.localChildKey).starCoins,
      happyChanceCards: repo.getProfile(c.localChildKey).happyChanceCards,
      points: repo.getProfile(c.localChildKey).points,
    },
    { coins: 10, starCoins: 11, happyChanceCards: 12, points: { snack: 13, toy: 14, game: 15 } },
  );
});

test("activeLocalChildKeyは存在するprofileまたはnullだけを許可する", () => {
  const repo = repository();
  const a = repo.createProfile({ childName: "A" });
  assert.equal(repo.setActiveLocalChild(a.localChildKey), a.localChildKey);
  assert.equal(repo.getActiveLocalChild().localChildKey, a.localChildKey);
  assert.throws(() => repo.setActiveLocalChild(UUID_C), /existing profile/);
  assert.equal(repo.getActiveLocalChild().localChildKey, a.localChildKey);
  assert.equal(repo.setActiveLocalChild(null), null);
  assert.equal(repo.getActiveLocalChild(), null);
});

test("malformed v2、version不正、key不一致、dangerous keyを拒否する", () => {
  const valid = identity.createEmptyStore(FIXED_NOW);
  assert.throws(() => identity.parseStore("{"), /invalid JSON/);
  assert.throws(() => identity.validateStore({ ...valid, version: 1 }), /version/);

  const profile = identity.createProfileData({ localChildKey: UUID_A, childName: "A" }, { now: () => new Date(FIXED_NOW) });
  assert.throws(() => identity.validateStore({ ...valid, profiles: { [UUID_C]: profile } }), /must match/);
  const polluted = JSON.stringify({ ...valid }).replace('"profiles":{}', '"profiles":{},"__proto__":{"polluted":true}');
  assert.throws(() => identity.parseStore(polluted), /dangerous key/);
});

test("NaNとInfinityをprofileおよび入れ子で拒否する", () => {
  const profile = identity.createProfileData({ localChildKey: UUID_A }, { now: () => new Date(FIXED_NOW) });
  assert.throws(() => identity.validateProfile({ ...profile, coins: NaN }, UUID_A), /finite/);
  assert.throws(() => identity.validateProfile({ ...profile, starCoins: Infinity }, UUID_A), /finite/);
  assert.throws(() => identity.validateProfile({ ...profile, points: { ...profile.points, snack: Infinity } }, UUID_A), /finite/);
});

test("重複localChildKeyを上書きせず拒否する", () => {
  const repo = repository(new MemoryStorage(), [UUID_A, UUID_A]);
  repo.createProfile({ childName: "A" });
  assert.throws(() => repo.createProfile({ childName: "duplicate" }), /already exists/);
  assert.equal(repo.getAllProfiles().length, 1);
  assert.equal(repo.getProfile(UUID_A).childName, "A");
});

test("write後にreadbackし、破損時は以前のv2 raw値へ戻す", () => {
  const storage = new MemoryStorage();
  const repo = repository(storage);
  repo.createProfile({ childName: "A" });
  const before = storage.getItem(identity.STORAGE_KEY);
  storage.corruptNextV2Write = true;
  assert.throws(() => repo.updateProfile(UUID_A, { childName: "壊さない" }), /previous data was restored/);
  assert.equal(storage.getItem(identity.STORAGE_KEY), before);
  assert.equal(repo.getProfile(UUID_A).childName, "A");
});

test("corrupted v2は安全に拒否し、自動初期化も書込みもしない", () => {
  const storage = new MemoryStorage({ [identity.STORAGE_KEY]: "{broken" });
  const repo = repository(storage);
  assert.throws(() => repo.getAllProfiles(), /invalid JSON/);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(identity.STORAGE_KEY), "{broken");
});

test("v2未作成のreadは空storeを返すが書き込まない", () => {
  const storage = new MemoryStorage();
  const repo = repository(storage);
  const root = repo.readStore();
  assert.equal(root.version, 2);
  assert.equal(root.activeLocalChildKey, null);
  assert.deepEqual(root.profiles, {});
  assert.equal(storage.getItem(identity.STORAGE_KEY), null);
  assert.equal(storage.writes.length, 0);
});

test("v1とcloudMapping v1をbyte-equivalentに保ちclearを呼ばない", () => {
  const legacyRaw = '{"childName":"D","coins":3,"future":{"spacing":"kept"}}';
  const mappingRaw = '{"appId":"hapichike","version":1,"mappings":[{"localChildKey":"legacy-single-profile"}]}';
  const storage = new MemoryStorage({ [V1_KEY]: legacyRaw, [MAPPING_V1_KEY]: mappingRaw });
  const repo = repository(storage);
  const a = repo.createProfile({ childName: "new local only" });
  repo.setActiveLocalChild(a.localChildKey);
  repo.updateProfile(a.localChildKey, { coins: 4 });
  assert.equal(storage.getItem(V1_KEY), legacyRaw);
  assert.equal(storage.getItem(MAPPING_V1_KEY), mappingRaw);
  assert.equal(storage.clearCalls, 0);
  assert.ok(storage.writes.every(([key]) => key === identity.STORAGE_KEY));
});

test("removeProfileはPhase 2.5Aでは常に禁止する", () => {
  const repo = repository();
  assert.throws(() => repo.removeProfile(UUID_A), /disabled/);
});

test("randomUUID非対応時は安全でないfallbackを使わず失敗する", () => {
  assert.throws(() => identity.generateLocalChildKey({}), /randomUUID is required/);
});

test("Phase 2.5A moduleはCloud、v1、mapping、clear、reward bridgeへ接続しない", () => {
  const coreSource = fs.readFileSync(path.join(__dirname, "../src/child-identity-core.js"), "utf8");
  const repositorySource = fs.readFileSync(path.join(__dirname, "../src/profile-repository.js"), "utf8");
  const source = `${coreSource}\n${repositorySource}`;
  assert.doesNotMatch(source, /kidsVegasCasino\.v1|cloudMapping|supabase\.(?:auth|from|rpc)|commitReward|HapichikeOnlineRewards|localStorage\.clear/i);
  assert.doesNotMatch(source, /Math\.random|Date\.now/);
});
