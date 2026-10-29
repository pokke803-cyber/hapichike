const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const core = require("../src/initial-import-core.js");

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
  assert.equal(preview.import_version, 1);
  assert.match(preview.source_snapshot_hash, /^[0-9a-f]{64}$/);
  assert.equal(preview.parent_approved, true);
  assert.equal(typeof core.send, "undefined");
});

test("backupと親承認がないpreviewを拒否する", async () => {
  await assert.rejects(() => core.createInitialImportPreview({ childId: "child-1", balances, parentApproved: true }, { cryptoApi: webcrypto }), /backup/);
  await assert.rejects(() => core.createInitialImportPreview({ childId: "child-1", balances, backupCreatedAt: "2026-10-29T00:00:00.000Z", parentApproved: false }, { cryptoApi: webcrypto }), /親/);
});
