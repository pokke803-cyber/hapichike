const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const core = require("../src/initial-import-core.js");

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.writes = []; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.writes.push([key, String(value)]); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const balances = {
  tickets: -2,
  star_coins: 3,
  sweets_pay: -4,
  toy_pay: 5,
  game_pay: -6,
  happy_chance_cards: 1,
};

test("snapshot validationはticketsとPAYの負数を維持する", () => {
  assert.deepEqual(core.validateSnapshotBalances(balances), balances);
});

test("snapshot validationは非整数、starとhappy chanceの負数を拒否する", () => {
  assert.throws(() => core.validateSnapshotBalances({ ...balances, tickets: NaN }), /有限の整数/);
  assert.throws(() => core.validateSnapshotBalances({ ...balances, star_coins: -1 }), /0以上/);
  assert.throws(() => core.validateSnapshotBalances({ ...balances, happy_chance_cards: -1 }), /0以上/);
});

test("canonical snapshotとSHA-256が固定入力に対して安定する", async () => {
  const canonical = core.canonicalizeSnapshot(balances);
  assert.equal(canonical, '{"app_id":"hapichike","import_version":1,"balances":{"tickets":-2,"star_coins":3,"sweets_pay":-4,"toy_pay":5,"game_pay":-6,"happy_chance_cards":1}}');
  assert.equal(
    await core.sha256Hex(canonical, webcrypto),
    "a15250b67b4e4ac93518ccc66cad833c7607617149b259a8881d58d150ab39e8",
  );
});

test("previewは送信せずRPC payload候補を生成する", async () => {
  const preview = await core.createInitialImportPreview({
    childId: "child-1",
    balances,
    backupCreatedAt: "2026-10-29T00:00:00.000Z",
    parentApproved: true,
  }, {
    cryptoApi: webcrypto,
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(preview.import_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(preview.app_id, "hapichike");
  assert.equal(preview.import_version, 1);
  assert.match(preview.source_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.equal(preview.parent_approved, true);
  assert.equal(typeof core.send, "undefined");
});

test("backupと親承認がないpreviewを拒否する", async () => {
  await assert.rejects(() => core.createInitialImportPreview({ childId: "child-1", balances, parentApproved: true }, { cryptoApi: webcrypto }), /backup/);
  await assert.rejects(() => core.createInitialImportPreview({ childId: "child-1", balances, backupCreatedAt: "2026-10-29T00:00:00.000Z", parentApproved: false }, { cryptoApi: webcrypto }), /親/);
});

test("import_idはUUIDだけを受け付ける", async () => {
  const input = {
    childId: "child-1",
    balances,
    backupCreatedAt: "2026-10-29T00:00:00.000Z",
    parentApproved: true,
  };
  await assert.rejects(
    () => core.createInitialImportPreview(input, { cryptoApi: webcrypto, importId: "not-a-uuid" }),
    /UUID/,
  );
  assert.throws(
    () => core.validatePendingPreview({
      app_id: "hapichike",
      child_id: "child-1",
      import_id: "not-a-uuid",
      import_version: 1,
      source_snapshot_hash: "a".repeat(64),
      balances,
      backup_created_at: "2026-10-29T00:00:00.000Z",
      parent_approved: true,
      canonical_snapshot: core.canonicalizeSnapshot(balances),
    }),
    /不正/,
  );
});

function readyInput(overrides = {}) {
  return {
    loggedIn: true,
    household: true,
    localChild: true,
    mapping: true,
    backup: true,
    backupCurrent: true,
    localSnapshot: true,
    cloudBalanceLoaded: true,
    cloudBalance: {
      tickets: 0,
      star_coins: 0,
      sweets_pay: 0,
      toy_pay: 0,
      game_pay: 0,
      happy_chance_cards: 0,
    },
    syncStateLoaded: true,
    syncState: null,
    rewardLogsLoaded: true,
    rewardLogCount: 0,
    role: "owner",
    ...overrides,
  };
}

test("readinessはbackup・mapping・権限・Cloud未初期化をすべて必須にする", () => {
  assert.equal(core.evaluateReadiness(readyInput()).ready, true);
  assert.equal(core.evaluateReadiness(readyInput({ role: "parent" })).ready, true);
  assert.equal(core.evaluateReadiness(readyInput({ backup: false })).ready, false);
  assert.equal(core.evaluateReadiness(readyInput({ mapping: false })).ready, false);
  assert.equal(core.evaluateReadiness(readyInput({ role: "viewer" })).ready, false);
  assert.equal(core.evaluateReadiness(readyInput({ cloudBalance: { ...readyInput().cloudBalance, tickets: 1 } })).cloudInitialized, true);
  assert.equal(core.evaluateReadiness(readyInput({ rewardLogCount: 1 })).cloudInitialized, true);
  assert.equal(core.evaluateReadiness(readyInput({ syncState: { initial_import_completed_at: "2026-10-29T01:00:00.000Z" } })).importComplete, true);
  assert.equal(core.evaluateReadiness(readyInput({ cloudBalance: null })).cloudInitialized, false);
});

test("initialized済みChild A/B相当では実行判定がfalseでRPC呼出し0件", () => {
  let rpcCalls = 0;
  const approvals = { backup: true, mapping: true, snapshot: true, oneTime: true };
  const initializedChildren = [
    readyInput({ cloudBalance: { ...readyInput().cloudBalance, tickets: 5 }, role: "owner" }),
    readyInput({ cloudBalance: { ...readyInput().cloudBalance, sweets_pay: 8 }, role: "parent" }),
  ];
  initializedChildren.forEach(input => {
    const readiness = core.evaluateReadiness(input);
    if (core.canExecuteImport(readiness, approvals, false)) rpcCalls += 1;
    assert.equal(readiness.cloudInitialized, true);
    assert.equal(readiness.ready, false);
  });
  assert.equal(rpcCalls, 0);
});

test("4項目すべての明示承認が必要", () => {
  assert.equal(core.approvalsComplete({ backup: true, mapping: true, snapshot: true, oneTime: false }), false);
  assert.equal(core.approvalsComplete({ backup: true, mapping: true, snapshot: true, oneTime: true }), true);
  const readiness = core.evaluateReadiness(readyInput());
  assert.equal(core.canExecuteImport(readiness, { backup: true, mapping: true, snapshot: true, oneTime: true }, false), true);
  assert.equal(core.canExecuteImport(readiness, { backup: true, mapping: true, snapshot: true, oneTime: true }, true), false);
});

test("backup gateは現在の6残高との一致を専用keyで確認する", () => {
  const main = JSON.stringify({ coins: 12 });
  const storage = new MemoryStorage({ "kidsVegasCasino.v1": main });
  const metadata = core.recordBackupMetadata(storage, "2026-10-29T00:00:00.000Z", balances);
  assert.equal(metadata.backup_created_at, "2026-10-29T00:00:00.000Z");
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], core.BACKUP_METADATA_KEY);
  assert.equal(storage.getItem("kidsVegasCasino.v1"), main);
  assert.equal(core.readBackupMetadata(storage).app_id, "hapichike");
  assert.equal(core.isBackupCurrent(metadata, balances), true);
  assert.equal(core.isBackupCurrent(metadata, { ...balances, tickets: balances.tickets + 1 }), false);
});

test("network retry用pending payloadは同じsnapshotなら同じimport_idを再利用できる", async () => {
  const storage = new MemoryStorage();
  const input = {
    childId: "child-1",
    balances,
    backupCreatedAt: "2026-10-29T00:00:00.000Z",
    parentApproved: true,
  };
  const preview = await core.createInitialImportPreview(input, {
    cryptoApi: webcrypto,
    randomUUID: () => "00000000-0000-4000-8000-000000000002",
  });
  core.savePendingPreview(storage, preview);
  const pending = core.readPendingPreview(storage);
  assert.equal(pending.import_id, preview.import_id);
  assert.equal(await core.matchesPreview(pending, input, { cryptoApi: webcrypto }), true);
  assert.equal(await core.matchesPreview(pending, { ...input, balances: { ...balances, tickets: 99 } }, { cryptoApi: webcrypto }), false);
});
