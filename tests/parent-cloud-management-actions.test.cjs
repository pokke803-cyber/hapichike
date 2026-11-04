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
  assert.equal(result.envelope.version, 2);
  assert.equal(importCore.isBackupCurrent(result.metadata, result.profile.balances), true);
  assert.doesNotMatch(JSON.stringify(result.envelope), /secret|parentPassword/);
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
});
