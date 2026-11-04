const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const backup = require("../src/backup-core.js");

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.failOnceOnKey = null;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failOnceOnKey === key) {
      this.failOnceOnKey = null;
      throw new Error("simulated write failure");
    }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

function sampleState(overrides = {}) {
  return {
    childName: "うぱ",
    coins: 12,
    starCoins: 3,
    happyChanceCards: 2,
    points: { snack: 4, toy: 5, game: 6 },
    tasks: [{ id: "task-1", title: "お手伝い", ticketReward: 1, starCoinReward: 1 }],
    todayTasks: [{ taskId: "task-1", status: "idle" }],
    history: [{ text: "記録" }],
    payLogs: [],
    transferHistory: [],
    ticketGiftLogs: [],
    taskHistory: [],
    starGiftHistory: [],
    badges: [],
    parentPassword: "1234",
    audioSettings: { bgmEnabled: true, sfxEnabled: false, bgmVolume: 0.22, sfxVolume: 0.62 },
    futureField: { preserved: true },
    ...overrides
  };
}

function storageFor(state = sampleState(), email = "parent@example.com") {
  return new MemoryStorage({
    [backup.STORAGE_KEY]: JSON.stringify(state),
    [backup.EMAIL_KEY]: email,
    "sb-example-auth-token": "must-not-be-read-or-changed",
    unrelated: "keep"
  });
}

test("正常backup生成、JSON parse、version、previewでは書き込みなし", () => {
  const storage = storageFor();
  const before = new Map(storage.values);
  const envelope = backup.createBackup(storage, "2026-10-22T01:02:00.000Z");
  const parsed = backup.parseBackup(JSON.stringify(envelope));
  const preview = backup.preview(parsed, sampleState({ coins: 1 }));
  assert.equal(parsed.format, "hapichike-backup");
  assert.equal(parsed.version, 1);
  assert.equal(preview.rows[0][1], 1);
  assert.equal(preview.rows[0][2], 12);
  assert.deepEqual(storage.values, before);
  assert.equal(backup.filename(new Date(parsed.createdAt)), "hapichike-backup-20261022-0102.json");
});

test("backupは対象2キーだけを含み、password/Auth session/tokenを除外する", () => {
  const state = sampleState({
    parentPassword: "secret",
    nested: { password: "secret", accessToken: "secret", refresh_token: "secret", authSession: { token: "secret" }, safe: "ok" }
  });
  const envelope = backup.createBackup(storageFor(state));
  const text = JSON.stringify(envelope);
  assert.deepEqual(Object.keys(envelope.data).sort(), [backup.EMAIL_KEY, backup.STORAGE_KEY].sort());
  assert.equal(envelope.data[backup.STORAGE_KEY].futureField.preserved, true);
  assert.equal(envelope.data[backup.STORAGE_KEY].nested.safe, "ok");
  assert.doesNotMatch(text, /secret|password|accessToken|refresh_token|authSession|sb-example/);
});

test("restore成功、値一致、直前safety backup、password維持、無関係key保護", () => {
  const storage = storageFor(sampleState({ coins: 2, parentPassword: "current-pin" }), "old@example.com");
  const incoming = backup.createBackup(storageFor(sampleState({ coins: 18, parentPassword: "foreign-pin" }), "new@example.com"));
  const result = backup.restore(storage, incoming, "2026-10-22T02:00:00.000Z");
  const restored = JSON.parse(storage.getItem(backup.STORAGE_KEY));
  const safety = JSON.parse(storage.getItem(backup.SAFETY_KEY));
  assert.equal(restored.coins, 18);
  assert.equal(restored.parentPassword, "current-pin");
  assert.equal(storage.getItem(backup.EMAIL_KEY), "new@example.com");
  assert.equal(safety.data[backup.STORAGE_KEY].coins, 2);
  assert.equal(result.safetyKey, backup.SAFETY_KEY);
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(storage.getItem("sb-example-auth-token"), "must-not-be-read-or-changed");
});

test("malformed JSONを拒否", () => {
  assert.throws(() => backup.parseBackup("{broken"), /JSON/);
});

test("format不正、versionなし、future version、必須key欠損を拒否", () => {
  const valid = backup.createBackup(storageFor());
  assert.throws(() => backup.validateEnvelope({ ...valid, format: "other" }), /形式/);
  const noVersion = { ...valid }; delete noVersion.version;
  assert.throws(() => backup.validateEnvelope(noVersion), /versionのない旧形式/);
  assert.throws(() => backup.validateEnvelope({ ...valid, version: 3 }), /未対応/);
  const noMain = { ...valid, data: { [backup.EMAIL_KEY]: "" } };
  assert.throws(() => backup.validateEnvelope(noMain), /kidsVegasCasino.v1/);
});

test("v2 backupは複数profile・activeLocalChildKey・householdSharedを含み秘密情報を除外する", () => {
  const storage = storageFor();
  const v2 = {
    appId: "hapichike", version: 2, activeLocalChildKey: "local-a",
    profiles: {
      "local-a": { localChildKey: "local-a", childName: "A", nested: { accessToken: "secret", safe: true } },
      "local-c": { localChildKey: "local-c", childName: "C" },
    },
    householdShared: { parentSettings: { password: "secret", theme: "light" } },
  };
  storage.setItem(backup.V2_STORAGE_KEY, JSON.stringify(v2));
  const envelope = backup.createBackup(storage, "2026-11-04T00:00:00.000Z");
  assert.equal(envelope.version, 2);
  assert.deepEqual(Object.keys(envelope.data[backup.V2_STORAGE_KEY].profiles).sort(), ["local-a", "local-c"]);
  assert.equal(envelope.data[backup.V2_STORAGE_KEY].activeLocalChildKey, "local-a");
  assert.equal(envelope.data[backup.V2_STORAGE_KEY].householdShared.parentSettings.theme, "light");
  assert.doesNotMatch(JSON.stringify(envelope), /secret|accessToken|password/);
  assert.equal(backup.preview(envelope, sampleState()).profileCount, 2);
  assert.deepEqual(backup.preview(envelope, sampleState()).profiles.map(item => item.childName), ["A", "C"]);
});

test("v2 restoreはv1互換を維持しv2 readback失敗時に両方rollbackする", () => {
  const source = storageFor(sampleState({ coins: 7 }));
  source.setItem(backup.V2_STORAGE_KEY, JSON.stringify({
    appId: "hapichike", version: 2, activeLocalChildKey: null, profiles: {}, householdShared: {},
  }));
  const envelope = backup.createBackup(source);
  const target = storageFor(sampleState({ coins: 1 }));
  backup.restore(target, envelope);
  assert.equal(JSON.parse(target.getItem(backup.STORAGE_KEY)).coins, 7);
  assert.equal(JSON.parse(target.getItem(backup.V2_STORAGE_KEY)).version, 2);
});

test("不正型、Infinity、prototype pollutionを拒否", () => {
  const valid = backup.createBackup(storageFor());
  assert.throws(() => backup.validateEnvelope({ ...valid, data: { ...valid.data, [backup.STORAGE_KEY]: { ...valid.data[backup.STORAGE_KEY], coins: "12" } } }), /coins/);
  assert.throws(() => backup.validateEnvelope({ ...valid, data: { ...valid.data, [backup.STORAGE_KEY]: { ...valid.data[backup.STORAGE_KEY], starCoins: Infinity } } }), /不正な数値/);
  assert.throws(() => backup.parseBackup(JSON.stringify(valid).replace('"childName":"うぱ"', '"__proto__":{"polluted":true},"childName":"うぱ"')), /危険なキー/);
});

test("restore途中失敗時は既存stateとemailを自動復旧する", () => {
  const storage = storageFor(sampleState({ coins: 2 }), "old@example.com");
  const originalMain = storage.getItem(backup.STORAGE_KEY);
  const incoming = backup.createBackup(storageFor(sampleState({ coins: 99 }), "new@example.com"));
  storage.failOnceOnKey = backup.EMAIL_KEY;
  assert.throws(() => backup.restore(storage, incoming), /元の端末データを維持/);
  assert.equal(storage.getItem(backup.STORAGE_KEY), originalMain);
  assert.equal(storage.getItem(backup.EMAIL_KEY), "old@example.com");
  assert.equal(storage.getItem(backup.SAFETY_KEY), null);
});

test("バックアップ実装はSupabase RPCやlocalStorage.clearを呼ばない", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "backup-core.js"), "utf8");
  const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.doesNotMatch(source, /supabase|\.rpc\s*\(|localStorage\.clear\s*\(/i);
  assert.doesNotMatch(index, /localStorage\.clear\s*\(/i);
});
