const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("../src/child-identity-core.js");
const migration = require("../src/profile-migration.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-11-01T03:00:00.000Z";
const MAPPING_RAW = '{"version":1,"mappings":[{"localChildKey":"legacy-single-profile"}]}';

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.writes = []; this.removes = []; this.corruptV2 = false; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.writes.push([key, String(value)]);
    if (key === migration.V2_KEY && this.corruptV2) { this.corruptV2 = false; this.values.set(key, "{broken"); return; }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.removes.push(key); this.values.delete(key); }
}

function legacy(overrides = {}) {
  return {
    childName: "旧名", coins: 1, starCoins: 2, happyChanceCards: 6,
    points: { snack: 3, toy: 4, game: 5 },
    tasks: [{ id: "dish", title: "皿洗い", icon: "🍽️", category: "cooking", difficulty: "normal", ticketReward: 2, rewardType: "ticket", starCoinReward: 1, isDefault: false, status: "done" }],
    todayTasks: [{ taskId: "dish", status: "done", completedAt: "今日", ticketGranted: true, ticketReward: 2, rewardType: "ticket", starCoinReward: 1 }],
    history: [{ type: "custom-legacy-type", text: "原形", nested: { value: 1 } }],
    payLogs: [{ id: "pay-1" }], transferHistory: [{ id: "transfer-1" }], ticketGiftLogs: [{ id: "gift-1" }],
    taskHistory: [{ id: "task-history-1" }], starGiftHistory: ["ありがとう"], badges: ["first"],
    lastDailyResetKey: "2026-10-31", parentPassword: "1234",
    audioSettings: { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.2, sfxVolume: 0.6 },
    ...overrides,
  };
}

function setup(source = legacy(), extra = {}) {
  const raw = JSON.stringify(source);
  return { raw, storage: new MemoryStorage({ [migration.V1_KEY]: raw, [migration.CLOUD_MAPPING_V1_KEY]: MAPPING_RAW, ...extra }) };
}

function options(extra = {}) {
  return { targetDisplayName: "移行先", now: () => new Date(NOW), cryptoApi: { randomUUID: () => UUID_A }, ...extra };
}

function previewAndApply(storage, extra = {}) {
  const opts = options(extra);
  const preview = migration.previewLegacyMigration(storage, opts);
  return { preview, result: migration.applyLegacyMigration(storage, { ...opts, previewToken: preview.previewToken }) };
}

test("valid previewは必要項目を返し、dry-run write 0", () => {
  const { storage } = setup();
  const preview = migration.previewLegacyMigration(storage, options());
  assert.equal(storage.writes.length, 0);
  assert.equal(preview.sourceChildName, "旧名");
  assert.equal(preview.targetDisplayName, "移行先");
  assert.deepEqual(preview.balances, { tickets: 1, starCoins: 2, sweetsPay: 3, toyPay: 4, gamePay: 5, happyChanceCards: 6 });
  assert.deepEqual(preview.todayTasks, { count: 1, completed: 1, pending: 0 });
  assert.equal(preview.taskAssignments, 1);
  assert.equal(preview.completionState[0].ticketGranted, true);
  assert.equal(preview.historyCount, 6);
  assert.equal(preview.progress.badgeCount, 1);
  assert.equal(preview.resetState.lastDailyResetKey, "2026-10-31");
  assert.equal(preview.householdShared.taskMasterCount, 1);
  assert.deepEqual(preview.excludedSecretFields, ["parentPassword"]);
  assert.deepEqual(preview.excludedDeviceLocalFields, ["audioSettings"]);
  assert.equal(preview.canApply, true);
});

test("applyは新UUID profileへ6残高・task assignment・history・progress・resetを原形移行する", () => {
  const { storage } = setup();
  const { result } = previewAndApply(storage);
  const root = identity.parseStore(storage.getItem(migration.V2_KEY));
  const profile = root.profiles[UUID_A];
  assert.equal(result.localChildKey, UUID_A);
  assert.equal(profile.childName, "移行先");
  assert.deepEqual({ coins: profile.coins, starCoins: profile.starCoins, points: profile.points, happyChanceCards: profile.happyChanceCards },
    { coins: 1, starCoins: 2, points: { snack: 3, toy: 4, game: 5 }, happyChanceCards: 6 });
  assert.deepEqual(profile.todayTasks, legacy().todayTasks);
  assert.deepEqual(profile.history, legacy().history);
  assert.equal(profile.history[0].type, "custom-legacy-type");
  assert.deepEqual(profile.payLogs, legacy().payLogs);
  assert.deepEqual(profile.badges, ["first"]);
  assert.equal(profile.lastDailyResetKey, "2026-10-31");
  assert.equal(root.activeLocalChildKey, UUID_A);
});

test("task masterはsharedだけ、assignmentはprofileだけ、legacy statusはextrasへ分離", () => {
  const { storage } = setup();
  previewAndApply(storage);
  const root = JSON.parse(storage.getItem(migration.V2_KEY));
  assert.equal(root.householdShared.taskMaster[0].id, "dish");
  assert.equal("status" in root.householdShared.taskMaster[0], false);
  assert.equal(root.profiles[UUID_A].tasks.length, 0);
  assert.equal(root.profiles[UUID_A].todayTasks[0].taskId, "dish");
  assert.deepEqual(root.householdShared.legacyExtras.taskStatuses, [{ taskId: "dish", status: "done" }]);
});

test("unknown fieldはUNDECIDEDならapply禁止、明示scopeならlegacyExtrasへ原形保持", () => {
  const { storage } = setup(legacy({ childFuture: { x: [1, 2] }, householdFuture: { enabled: true } }));
  const undecided = migration.previewLegacyMigration(storage, options());
  assert.deepEqual(undecided.legacyExtras.undecided, ["childFuture", "householdFuture"]);
  assert.equal(undecided.canApply, false);
  assert.throws(() => migration.applyLegacyMigration(storage, { ...options(), previewToken: undecided.previewToken }), /explicit scope/);
  const scopes = { childFuture: "profile", householdFuture: "household" };
  const { result } = previewAndApply(storage, { legacyFieldScopes: scopes });
  const root = JSON.parse(storage.getItem(migration.V2_KEY));
  assert.deepEqual(result.profile.legacyExtras.childFuture, { x: [1, 2] });
  assert.deepEqual(root.householdShared.legacyExtras.householdFuture, { enabled: true });
});

test("parentPasswordはprofile/shared/safety sourceから除外し、credential疑いfieldは停止", () => {
  const { storage } = setup();
  previewAndApply(storage);
  const allV2 = storage.getItem(migration.V2_KEY);
  const safety = JSON.parse(storage.getItem(migration.SAFETY_KEY));
  assert.doesNotMatch(allV2, /parentPassword|1234/);
  assert.equal("parentPassword" in safety.source, false);
  const bad = setup(legacy({ access_token: "do-not-log" })).storage;
  assert.throws(() => migration.previewLegacyMigration(bad, options()), /forbidden secret field/);
  const nestedBad = setup(legacy({ history: [{ authSession: "do-not-log" }] })).storage;
  assert.throws(() => migration.previewLegacyMigration(nestedBad, options()), /forbidden secret field/);
});

test("dangerous key、非finite相当、malformed required sourceを拒否する", () => {
  const dangerousRaw = JSON.stringify(legacy()).replace(/}$/, ',"__proto__":{"polluted":true}}');
  assert.throws(() => migration.previewLegacyMigration(new MemoryStorage({ [migration.V1_KEY]: dangerousRaw }), options()), /dangerous key/);
  assert.throws(() => migration.previewLegacyMigration(setup(legacy({ coins: null })).storage, options()), /finite/);
  assert.throws(() => migration.previewLegacyMigration(setup(legacy({ tasks: "bad" })).storage, options()), /must be an array/);
  assert.throws(() => migration.previewLegacyMigration(setup(legacy({ points: { snack: 1, toy: 2, game: null } })).storage, options()), /finite/);
});

test("target選択は必須で、legacy-single-profileをkeyに再利用しない", () => {
  const { storage } = setup();
  assert.throws(() => migration.previewLegacyMigration(storage, {}), /explicitly selected/);
  const { result } = previewAndApply(storage);
  assert.match(result.localChildKey, identity.UUID_V4_PATTERN);
  assert.notEqual(result.localChildKey, migration.SOURCE_NAME);
});

test("safety copyとmetadataを作り、v1とcloudMapping v1はbyte-equivalent", () => {
  const { raw, storage } = setup();
  const { result } = previewAndApply(storage);
  const safety = JSON.parse(storage.getItem(migration.SAFETY_KEY));
  const root = JSON.parse(storage.getItem(migration.V2_KEY));
  assert.equal(safety.sourceHash, result.sourceHash);
  assert.equal(safety.createdAt, NOW);
  assert.deepEqual(root.identityMigrations[0], { migrationVersion: 1, migratedAt: NOW, source: "legacy-single-profile", targetLocalChildKey: UUID_A, sourceHash: result.sourceHash });
  assert.equal(storage.getItem(migration.V1_KEY), raw);
  assert.equal(storage.getItem(migration.CLOUD_MAPPING_V1_KEY), MAPPING_RAW);
});

test("source hashはcanonicalでproperty順に依存せずSHA-256", () => {
  assert.equal(migration.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(migration.canonicalize({ b: 2, a: 1 }), migration.canonicalize({ a: 1, b: 2 }));
  const first = migration.previewLegacyMigration(setup(legacy({ parentPassword: "first-secret" })).storage, options());
  const second = migration.previewLegacyMigration(setup(legacy({ parentPassword: "second-secret" })).storage, options());
  assert.equal(first.sourceHash, second.sourceHash);
  assert.notEqual(first.previewToken, second.previewToken);
});

test("migration metadataはhash・UUID参照・重複をschema validationする", () => {
  const { storage } = setup();
  previewAndApply(storage);
  const root = JSON.parse(storage.getItem(migration.V2_KEY));
  assert.throws(() => identity.validateStore({ ...root, identityMigrations: [{ ...root.identityMigrations[0], sourceHash: "bad" }] }), /SHA-256/);
  assert.throws(() => identity.validateStore({ ...root, identityMigrations: [{ ...root.identityMigrations[0], targetLocalChildKey: UUID_C }] }), /existing profile/);
  assert.throws(() => identity.validateStore({ ...root, identityMigrations: [root.identityMigrations[0], root.identityMigrations[0]] }), /duplicate sourceHash/);
});

test("同じsourceの二重migrationは別profileへコピーせず拒否", () => {
  const { storage } = setup();
  const first = previewAndApply(storage);
  const secondPreview = migration.previewLegacyMigration(storage, options({ cryptoApi: { randomUUID: () => UUID_C } }));
  assert.equal(secondPreview.canApply, false);
  assert.equal(secondPreview.duplicateMigration.targetLocalChildKey, first.result.localChildKey);
  assert.throws(() => migration.applyLegacyMigration(storage, { ...options({ cryptoApi: { randomUUID: () => UUID_C } }), previewToken: secondPreview.previewToken }), /already been migrated/);
  assert.equal(Object.keys(JSON.parse(storage.getItem(migration.V2_KEY)).profiles).length, 1);
});

test("preview後にsourceが変わった場合はwrite前に拒否", () => {
  const { storage } = setup();
  const opts = options();
  const preview = migration.previewLegacyMigration(storage, opts);
  storage.setItem(migration.V1_KEY, JSON.stringify(legacy({ coins: 99 })));
  const writesBefore = storage.writes.length;
  assert.throws(() => migration.applyLegacyMigration(storage, { ...opts, previewToken: preview.previewToken }), /source state changed/);
  assert.equal(storage.getItem(migration.V2_KEY), null);
  assert.equal(storage.writes.length, writesBefore);
});

test("existing v2 profileを保持して新profileだけ追加する", () => {
  const existing = identity.createEmptyStore(NOW);
  existing.profiles[UUID_C] = identity.createProfileData({ localChildKey: UUID_C, childName: "既存" }, { now: () => new Date(NOW) });
  existing.activeLocalChildKey = UUID_C;
  const { storage } = setup(legacy(), { [migration.V2_KEY]: JSON.stringify(existing) });
  previewAndApply(storage);
  const root = JSON.parse(storage.getItem(migration.V2_KEY));
  assert.equal(root.profiles[UUID_C].childName, "既存");
  assert.equal(root.profiles[UUID_A].childName, "移行先");
  assert.equal(root.activeLocalChildKey, UUID_A);
});

test("household sharedは同一taskを再利用し新規をmerge、既存fieldを保持", () => {
  const existing = identity.createEmptyStore(NOW);
  existing.householdShared.taskMaster = [{ id: "dish", title: "皿洗い", icon: "🍽️", category: "cooking", difficulty: "normal", ticketReward: 2, rewardType: "ticket", starCoinReward: 1, isDefault: false }, { id: "old", title: "既存" }];
  existing.householdShared.parentSettings = { theme: "blue" };
  const { storage } = setup(legacy(), { [migration.V2_KEY]: JSON.stringify(existing) });
  const preview = migration.previewLegacyMigration(storage, options());
  assert.deepEqual(preview.conflicts, []);
  migration.applyLegacyMigration(storage, { ...options(), previewToken: preview.previewToken });
  const shared = JSON.parse(storage.getItem(migration.V2_KEY)).householdShared;
  assert.equal(shared.taskMaster.length, 2);
  assert.deepEqual(shared.parentSettings, { theme: "blue" });
});

test("household task/reset/legacyExtras conflictは自動決定せずapply前に拒否", () => {
  const cases = [
    shared => { shared.taskMaster = [{ id: "dish", title: "別定義" }]; },
    shared => { shared.dailyResetPolicy = { hour: 5 }; },
    shared => { shared.legacyExtras = { taskStatuses: [{ taskId: "dish", status: "idle" }] }; },
  ];
  cases.forEach(change => {
    const existing = identity.createEmptyStore(NOW); change(existing.householdShared);
    const { storage } = setup(legacy(), { [migration.V2_KEY]: JSON.stringify(existing) });
    const preview = migration.previewLegacyMigration(storage, options());
    assert.ok(preview.conflicts.length > 0);
    assert.throws(() => migration.applyLegacyMigration(storage, { ...options(), previewToken: preview.previewToken }), /conflicts require parent resolution/);
    assert.equal(storage.writes.length, 0);
  });
});

test("v2 readback failureは以前のv2とactive keyへrollbackしsafety copyを保持", () => {
  const existing = identity.createEmptyStore(NOW);
  existing.profiles[UUID_C] = identity.createProfileData({ localChildKey: UUID_C, childName: "既存" }, { now: () => new Date(NOW) });
  existing.activeLocalChildKey = UUID_C;
  const previousRaw = JSON.stringify(existing);
  const { storage } = setup(legacy(), { [migration.V2_KEY]: previousRaw });
  const preview = migration.previewLegacyMigration(storage, options());
  storage.corruptV2 = true;
  assert.throws(() => migration.applyLegacyMigration(storage, { ...options(), previewToken: preview.previewToken }), /previous v2 was restored/);
  assert.equal(storage.getItem(migration.V2_KEY), previousRaw);
  assert.equal(JSON.parse(storage.getItem(migration.V2_KEY)).activeLocalChildKey, UUID_C);
  assert.ok(storage.getItem(migration.SAFETY_KEY));
});

test("migration moduleはCloud API、UI、clearへ接続しない", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/profile-migration.js"), "utf8");
  assert.doesNotMatch(source, /supabase\.(?:auth|from|rpc)|fetch\s*\(|localStorage\.clear|commitReward|window\.location/i);
});
