const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const actions = require("../src/parent/cloud-management-actions.js");
const mapping = require("../src/cloud-mapping-core.js");
const importCore = require("../src/initial-import-core.js");
const identity = require("../src/child-identity-core.js");
const domain = require("../src/profile-domain.js");

const V1 = {
  childName: "Local A", coins: 1, starCoins: 2, happyChanceCards: 6,
  points: { snack: 3, toy: 4, game: 5 }, tasks: [], todayTasks: [], history: [],
  payLogs: [], transferHistory: [], ticketGiftLogs: [], taskHistory: [], starGiftHistory: [], badges: [],
  lastDailyResetKey: "2026-11-04", parentPassword: "secret", audioSettings: { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.2, sfxVolume: 0.6 },
};
const CHILD_A = { id: "child-a", householdId: "house-a", displayName: "Child A" };
const CHILD_C = { id: "child-c", householdId: "house-a", displayName: "Child C" };
const LOCAL_A = "11111111-1111-4111-8111-111111111111";
const LOCAL_C = "22222222-2222-4222-8222-222222222222";

class Storage {
  constructor(values = {}) { this.data = new Map(Object.entries(values)); this.writes = []; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); this.writes.push(["set", key]); }
  removeItem(key) { this.data.delete(key); this.writes.push(["remove", key]); }
}

function storage(extra = {}) {
  const store = identity.createEmptyStore("2026-11-04T00:00:00.000Z");
  let profile = identity.createProfileData({ localChildKey: LOCAL_A, childName: "Local A v2" }, { now: () => new Date("2026-11-04T00:00:00.000Z") });
  profile = domain.setBalances(profile, { tickets: 1, starCoins: 2, sweetsPay: 3, toyPay: 4, gamePay: 5, happyChanceCards: 6 });
  store.profiles[LOCAL_A] = profile;
  store.activeLocalChildKey = LOCAL_A;
  return new Storage({ [mapping.MAIN_STORAGE_KEY]: JSON.stringify(V1), [identity.STORAGE_KEY]: JSON.stringify(store), ...extra });
}

test("backup作成はlegacy v1 metadataを記録しsecretを含めない", () => {
  const s = storage();
  const result = actions.createBackup(s, mapping.LOCAL_CHILD_KEY, "2026-11-04T00:00:00.000Z");
  assert.equal(result.envelope.version, 1);
  assert.equal(importCore.isBackupCurrent(result.metadata, result.profile.balances), true);
  assert.doesNotMatch(JSON.stringify(result.envelope), /secret|parentPassword/);
});

test("legacy backupはv2 profile不要でmigration・activation・Cloud writeを行わない", () => {
  const cases = [
    new Storage({ [mapping.MAIN_STORAGE_KEY]: JSON.stringify(V1) }),
    new Storage({
      [mapping.MAIN_STORAGE_KEY]: JSON.stringify(V1),
      [identity.STORAGE_KEY]: JSON.stringify(identity.createEmptyStore("2026-11-04T00:00:00.000Z")),
    }),
  ];
  cases.forEach(s => {
    const beforeV1 = s.getItem(mapping.MAIN_STORAGE_KEY);
    const beforeV2 = s.getItem(identity.STORAGE_KEY);
    const result = actions.createBackup(s, "", "2026-11-04T00:00:00.000Z");
    assert.equal(result.envelope.version, 1);
    assert.equal(result.profile.kind, "legacy");
    assert.equal(s.getItem(mapping.MAIN_STORAGE_KEY), beforeV1);
    assert.equal(s.getItem(identity.STORAGE_KEY), beforeV2);
    assert.equal(s.getItem(backupActivationKey()), null);
    assert.deepEqual(s.writes, [["set", importCore.BACKUP_METADATA_KEY]]);
  });
});

test("v2 active validはv2 backup、v2 active brokenだけLOCAL_INVALID", () => {
  const active = storage({ ["kidsVegasCasino.v2.activation"]: "active" });
  const result = actions.createBackup(active, mapping.LOCAL_CHILD_KEY, "2026-11-04T00:00:00.000Z");
  assert.equal(result.envelope.version, 2);
  assert.equal(result.profile.localChildKey, LOCAL_A);

  const broken = storage({
    ["kidsVegasCasino.v2.activation"]: "active",
    [identity.STORAGE_KEY]: JSON.stringify({
      appId: "hapichike", version: 2, activeLocalChildKey: null, profiles: {},
      householdShared: identity.createDefaultHouseholdShared(), updatedAt: "2026-11-04T00:00:00.000Z",
    }),
  });
  assert.throws(() => actions.createBackup(broken, ""), /LOCAL_INVALID/);
});

function backupActivationKey() { return "kidsVegasCasino.v2.activation"; }

test("Cloud Child Aの明示previewから0初期値profileを作り、Child C・active・v1・mappingを変えない", () => {
  const s = storage({ [backupActivationKey()]: "active" });
  const beforeRoot = identity.parseStore(s.getItem(identity.STORAGE_KEY));
  const beforeC = structuredClone(beforeRoot.profiles[LOCAL_A]);
  const beforeV1 = s.getItem(mapping.MAIN_STORAGE_KEY);
  const beforeMapping = s.getItem(mapping.MAPPING_V2_STORAGE_KEY);
  const preview = actions.previewLocalProfileCreation(s, {
    cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  });
  assert.deepEqual(preview.balances, { tickets: 0, starCoins: 0, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0 });
  assert.equal(preview.cloudWrite, false);
  assert.equal(s.writes.length, 0);
  const result = actions.createLocalProfile(s, preview, {
    parentApproved: true, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  }, { now: () => new Date("2026-11-10T00:00:00.000Z"), cryptoApi: { randomUUID: () => LOCAL_C } });
  const root = identity.parseStore(s.getItem(identity.STORAGE_KEY));
  assert.equal(result.profile.localChildKey, LOCAL_C);
  assert.equal(result.profile.childName, "Child A");
  assert.deepEqual(domain.getBalances(result.profile), preview.balances);
  assert.deepEqual(result.profile.todayTasks, []);
  assert.deepEqual(result.profile.history, []);
  assert.deepEqual(result.profile.badges, []);
  assert.equal(result.profile.lastDailyResetKey, "");
  assert.deepEqual(result.profile.pendingCloudIdentity, { supabaseChildId: "child-a", householdId: "house-a", preparedAt: "2026-11-10T00:00:00.000Z" });
  assert.deepEqual(root.profiles[LOCAL_A], beforeC);
  assert.equal(root.activeLocalChildKey, LOCAL_A);
  assert.equal(s.getItem(mapping.MAIN_STORAGE_KEY), beforeV1);
  assert.equal(s.getItem(mapping.MAPPING_V2_STORAGE_KEY), beforeMapping);
});

test("同じCloud ChildへのLocal profile重複作成とstale previewを拒否する", () => {
  const s = storage({ [backupActivationKey()]: "active" });
  const preview = actions.previewLocalProfileCreation(s, { cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] });
  actions.createLocalProfile(s, preview, {
    parentApproved: true, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A],
  }, { cryptoApi: { randomUUID: () => LOCAL_C } });
  assert.throws(() => actions.previewLocalProfileCreation(s, { cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] }), /LOCAL_PROFILE_DUPLICATE/);
  assert.throws(() => actions.createLocalProfile(s, preview, {
    parentApproved: true, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A],
  }), /PROFILE_CREATION_CONFLICT|LOCAL_PROFILE_DUPLICATE/);
  const childAPreview = actions.createMappingPreview(s, {
    localChildKey: LOCAL_C, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  });
  assert.equal(childAPreview.supabaseChildId, "child-a");
  assert.throws(() => actions.createMappingPreview(s, {
    localChildKey: LOCAL_C, cloudChild: CHILD_C, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  }), /MAPPING_CONFLICT/);
});

test("選択Local profileと表示中Cloud Childをmapping保存前でもread-only比較する", () => {
  const s = storage();
  const before = s.getItem(identity.STORAGE_KEY);
  const rows = actions.compareProfileToCloud(s, LOCAL_A, {
    tickets: 2, star_coins: 2, sweets_pay: 1, toy_pay: 4, game_pay: 5, happy_chance_cards: 6,
  });
  assert.equal(rows.find(row => row.key === "tickets").difference, -1);
  assert.equal(rows.find(row => row.key === "sweets_pay").difference, 2);
  assert.equal(s.getItem(identity.STORAGE_KEY), before);
});

test("mapping preview/saveはA→Aを許可し、親確認なし・cross-household・staleを拒否する", () => {
  const s = storage();
  const preview = actions.createMappingPreview(s, {
    localChildKey: LOCAL_A, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  });
  assert.match(preview.message, /Local Local A v2 を Cloud Child A/);
  assert.throws(() => actions.saveMapping(s, preview, { parentApproved: false, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] }), /確認/);
  assert.throws(() => actions.createMappingPreview(s, { localChildKey: LOCAL_A, cloudChild: CHILD_A, householdId: "house-b", visibleChildren: [CHILD_A] }), /MAPPING_CONFLICT/);
  s.setItem(mapping.MAPPING_V2_STORAGE_KEY, JSON.stringify({ appId: "hapichike", version: 2, mappings: [] }));
  assert.throws(() => actions.saveMapping(s, preview, { parentApproved: true, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] }), /CHILD_LOAD_FAILED/);
});

test("migration後のLocal C→Cloud C previewはread-onlyで必要情報とvalid判定を返す", () => {
  const s = storage();
  const root = identity.parseStore(s.getItem(identity.STORAGE_KEY));
  root.profiles[LOCAL_A].childName = "Child C";
  s.data.set(identity.STORAGE_KEY, JSON.stringify(root));
  const before = [...s.writes];
  const preview = actions.createMappingPreview(s, {
    localChildKey: LOCAL_A, cloudChild: CHILD_C, householdId: "house-a", visibleChildren: [CHILD_A, CHILD_C],
  });
  assert.equal(preview.localChildKey, LOCAL_A);
  assert.equal(preview.localDisplayName, "Child C");
  assert.equal(preview.supabaseChildId, "child-c");
  assert.equal(preview.cloudDisplayName, "Child C");
  assert.equal(preview.householdId, "house-a");
  assert.equal(preview.existingMapping, null);
  assert.equal(preview.duplicateConflict, false);
  assert.equal(preview.stale, false);
  assert.equal(preview.valid, true);
  assert.deepEqual(s.writes, before);
  assert.equal(s.getItem(mapping.MAPPING_V2_STORAGE_KEY), null);
});

test("mapping previewはcross-household・duplicate・staleを拒否し書き込まない", () => {
  const duplicateRaw = JSON.stringify({ appId: "hapichike", version: 2, mappings: [{
    localChildKey: "22222222-2222-4222-8222-222222222222", supabaseChildId: "child-c", householdId: "house-a", confirmedAt: "2026-11-01T00:00:00.000Z",
  }] });
  const staleRaw = JSON.stringify({ appId: "hapichike", version: 2, mappings: [{
    localChildKey: LOCAL_A, supabaseChildId: "missing-child", householdId: "house-a", confirmedAt: "2026-11-01T00:00:00.000Z",
  }] });
  const cases = [
    [storage(), { localChildKey: LOCAL_A, cloudChild: CHILD_C, householdId: "house-b", visibleChildren: [CHILD_C] }, /MAPPING_CONFLICT/],
    [storage({ [mapping.MAPPING_V2_STORAGE_KEY]: duplicateRaw }), { localChildKey: LOCAL_A, cloudChild: CHILD_C, householdId: "house-a", visibleChildren: [CHILD_C] }, /MAPPING_CONFLICT/],
    [storage({ [mapping.MAPPING_V2_STORAGE_KEY]: staleRaw }), { localChildKey: LOCAL_A, cloudChild: CHILD_C, householdId: "house-a", visibleChildren: [CHILD_C] }, /MAPPING_STALE/],
  ];
  cases.forEach(([s, input, expected]) => {
    const beforeRaw = s.getItem(mapping.MAPPING_V2_STORAGE_KEY);
    const beforeWrites = s.writes.length;
    assert.throws(() => actions.createMappingPreview(s, input), error => {
      assert.match(error.message, expected);
      assert.equal(error.previewDetails.valid, false);
      assert.equal(typeof error.previewDetails.duplicateConflict, "boolean");
      assert.equal(typeof error.previewDetails.stale, "boolean");
      return true;
    });
    assert.equal(s.writes.length, beforeWrites);
    assert.equal(s.getItem(mapping.MAPPING_V2_STORAGE_KEY), beforeRaw);
  });
});

test("同じCloud Childへの別Local mappingを拒否する", () => {
  const existing = JSON.stringify({ appId: "hapichike", version: 1, mappings: [{ localChildKey: "another-local", supabaseChildId: "child-a", householdId: "house-a", confirmedAt: "2026-11-01T00:00:00.000Z" }] });
  const v2Existing = existing.replace('"version":1', '"version":2');
  const s = storage({ [mapping.MAPPING_V2_STORAGE_KEY]: v2Existing });
  assert.throws(() => actions.createMappingPreview(s, { localChildKey: LOCAL_A, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] }), /MAPPING_CONFLICT/);
});

test("v2 mapping保存は専用keyだけへ書き、legacy v1 mappingを保持する", () => {
  const legacyRaw = JSON.stringify({ appId: "hapichike", version: 1, mappings: [{ localChildKey: mapping.LOCAL_CHILD_KEY, supabaseChildId: "child-a", householdId: "house-a", confirmedAt: "2026-11-01T00:00:00.000Z" }] });
  const s = storage({ [mapping.MAPPING_STORAGE_KEY]: legacyRaw });
  const preview = actions.createMappingPreview(s, { localChildKey: LOCAL_A, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] });
  const saved = actions.saveMapping(s, preview, { parentApproved: true, cloudChild: CHILD_A, householdId: "house-a", visibleChildren: [CHILD_A] }, "2026-11-04T01:00:00.000Z");
  assert.equal(saved.version, 2);
  assert.equal(saved.mappings[0].localChildKey, LOCAL_A);
  assert.equal(s.getItem(mapping.MAPPING_STORAGE_KEY), legacyRaw);
  assert.equal(JSON.parse(s.getItem(mapping.MAPPING_V2_STORAGE_KEY)).version, 2);
});

test("migration applyはChild選択とcurrent backupを必須にしCloud APIを持たない", () => {
  const s = storage();
  assert.throws(() => actions.applyMigration(s, { parentApproved: true, backupApproved: true, previewApproved: true, cloudWriteZeroApproved: true, targetChild: null }), /CHILD_LOAD_FAILED/);
  assert.throws(() => actions.applyMigration(s, { parentApproved: false }), /MIGRATION_CONFLICT/);
});

test("initial import previewはbackup/mapping readiness gateと同一pending import_idを保持する", async () => {
  const s = storage();
  actions.createBackup(s, mapping.LOCAL_CHILD_KEY, "2026-11-04T00:00:00.000Z");
  const readiness = { ready: true, cloudInitialized: false, importComplete: false };
  const preview = await actions.createImportPreview(s, {
    localChildKey: mapping.LOCAL_CHILD_KEY, childId: "child-a", readiness, parentApproved: true,
  }, { cryptoApi: webcrypto, randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  assert.equal(preview.import_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(importCore.readPendingPreview(s).import_id, preview.import_id);
  const approvals = { backup: true, mapping: true, snapshot: true, oneTime: true };
  assert.equal(actions.canExecuteImport({ readiness, approvals, importing: false, preview, childId: "child-a", mappingValid: true }), true);
  assert.equal(actions.canExecuteImport({ readiness, approvals, importing: true, preview, childId: "child-a", mappingValid: true }), false);
  assert.equal(actions.canExecuteImport({ readiness, approvals, importing: false, preview, childId: "child-c", mappingValid: true }), false);
});

test("Cloud Child切替とLocal profile選択は別stateとしてUIに実装される", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ui = fs.readFileSync(path.join(__dirname, "..", "parent", "parent.js"), "utf8");
  assert.match(ui, /selectedLocalChildKey/);
  assert.match(ui, /parentViewedSupabaseChildId/);
  assert.doesNotMatch(ui, /selectedLocalChildKey\s*=\s*state\.parentViewedSupabaseChildId/);
  assert.doesNotMatch(ui, /activeLocalChildKey\s*=\s*state\.parentViewedSupabaseChildId/);
  assert.match(ui, /async function handleMappingPreview\(\)/);
  assert.match(ui, /mappingPreviewButton\.addEventListener\("click", handleMappingPreview\)/);
  assert.match(ui, /mappingPreviewButton\.dataset\.handlerRegistered = "true"/);
  assert.match(ui, /await runtime\.readLocalIdentityState\(\)/);
  assert.match(ui, /renderMappingPreviewError\(error, state\)/);
  const html = fs.readFileSync(path.join(__dirname, "..", "parent", "index.html"), "utf8");
  assert.match(html, /id="mappingPreviewResult"/);
  assert.match(html, /id="profileCreationPreviewButton"/);
  assert.match(ui, /previewLocalProfileCreation/);
  assert.match(ui, /createLocalProfile/);
  assert.match(ui, /compareProfileToCloud/);
});
