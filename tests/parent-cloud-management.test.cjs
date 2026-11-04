const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../src/parent/cloud-management-core.js");
const mappingCore = require("../src/cloud-mapping-core.js");
const importCore = require("../src/initial-import-core.js");

const V1 = {
  childName: "Local A", coins: 1, starCoins: 2, happyChanceCards: 6,
  points: { snack: 3, toy: 4, game: 5 }, tasks: [], todayTasks: [], history: [],
  payLogs: [], transferHistory: [], ticketGiftLogs: [], taskHistory: [], starGiftHistory: [], badges: [],
  lastDailyResetKey: "2026-11-03", parentPassword: "secret", audioSettings: {},
};
const CLOUD = { tickets: 1, star_coins: 2, sweets_pay: 3, toy_pay: 4, game_pay: 5, happy_chance_cards: 6 };
const CHILDREN = [
  { id: "child-a", householdId: "house-a", displayName: "Child A" },
  { id: "child-c", householdId: "house-a", displayName: "Child C" },
];

class ReadOnlyStorage {
  constructor(data = {}) { this.data = { ...data }; this.writes = 0; }
  getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; }
  setItem() { this.writes += 1; throw new Error("write forbidden"); }
  removeItem() { this.writes += 1; throw new Error("write forbidden"); }
}

function mapping(childId = "child-a", householdId = "house-a") {
  return JSON.stringify({ appId: "hapichike", version: 1, mappings: [{ localChildKey: mappingCore.LOCAL_CHILD_KEY, supabaseChildId: childId, householdId, confirmedAt: "2026-11-01T00:00:00.000Z" }] });
}

function state(overrides = {}) {
  return {
    auth: { status: "signed_in" }, connection: { status: "ready" }, households: { status: "ready" }, selectedHouseholdId: "house-a",
    cloudChildren: { status: "ready", items: CHILDREN }, parentViewedSupabaseChildId: "child-a",
    viewedChildData: { status: "ready" }, viewedChildBalance: CLOUD, viewedChildRewardLogs: [], viewedChildSyncState: null,
    local: { legacyStatus: "success", v2Status: "missing", activeLocalChildKey: null, activeLocalChildExists: false, profileCount: 0 },
    ...overrides,
  };
}

function storage(extra = {}) {
  const base = { [core.V1_KEY]: JSON.stringify(V1), [core.MAPPING_KEY]: mapping() };
  Object.entries(extra).forEach(([key, value]) => { if (value === null) delete base[key]; else base[key] = value; });
  return new ReadOnlyStorage(base);
}

test("Parent A Child A comparison uses viewed Child mapping", () => {
  const result = core.inspect(storage(), state());
  assert.equal(result.selectedChild.displayName, "Child A");
  assert.equal(result.comparison.length, 6);
  assert.equal(result.mismatch, false);
});

test("Parent A Child C does not inherit Child A Local identity", () => {
  const result = core.inspect(storage(), state({ parentViewedSupabaseChildId: "child-c" }));
  assert.equal(result.localProfile.unresolved, true);
  assert.equal(result.mapping.viewedChildMatches, false);
});

test("Parent B only evaluates visible Child B", () => {
  const childB = { id: "child-b", householdId: "house-b", displayName: "Child B" };
  const result = core.inspect(storage({ [core.MAPPING_KEY]: mapping("child-b", "house-b") }), state({ selectedHouseholdId: "house-b", cloudChildren: { status: "ready", items: [childB] }, parentViewedSupabaseChildId: "child-b" }));
  assert.equal(result.selectedChild.displayName, "Child B");
  assert.equal(JSON.stringify(result).includes("child-a"), false);
  assert.equal(JSON.stringify(result).includes("child-c"), false);
});

test("Parent B does not expose stale Household A mapping details", () => {
  const childB = { id: "child-b", householdId: "house-b", displayName: "Child B" };
  const result = core.inspect(storage(), state({ selectedHouseholdId: "house-b", cloudChildren: { status: "ready", items: [childB] }, parentViewedSupabaseChildId: "child-b" }));
  assert.equal(result.mapping.status, "stale");
  assert.equal(result.mapping.item, null);
  assert.equal(JSON.stringify(result).includes("child-a"), false);
});

test("mapping valid, stale, mismatch and missing are distinguished", () => {
  assert.equal(core.inspect(storage(), state()).mapping.status, "valid");
  assert.equal(core.inspect(storage({ [core.MAPPING_KEY]: mapping("gone") }), state()).mapping.status, "stale");
  assert.equal(core.inspect(storage(), state({ parentViewedSupabaseChildId: "child-c" })).mapping.viewedChildMatches, false);
  assert.equal(core.inspect(storage({ [core.MAPPING_KEY]: null }), state()).mapping.status, "missing");
});

test("v2 mappingをlegacy v1より優先しlegacy documentは互換用に保持する", () => {
  const v2 = JSON.stringify({ appId: "hapichike", version: 2, mappings: [{ localChildKey: "local-v2", supabaseChildId: "child-c", householdId: "house-a", confirmedAt: "2026-11-04T00:00:00.000Z" }] });
  const result = core.inspect(storage({ [core.MAPPING_V2_KEY]: v2 }), state({ parentViewedSupabaseChildId: "child-c" }));
  assert.equal(result.mapping.version, 2);
  assert.equal(result.mapping.item.localChildKey, "local-v2");
});

test("initial import completed and not completed are read-only states", () => {
  assert.equal(core.inspect(storage(), state()).initialImport.readiness.importComplete, false);
  const completed = core.inspect(storage(), state({ viewedChildSyncState: { initial_import_completed_at: "2026-11-01T00:00:00Z", import_version: 1 } }));
  assert.equal(completed.initialImport.readiness.importComplete, true);
});

test("initial importはowner/parentだけをeligibleとしviewerはfail closed", () => {
  const zero = Object.fromEntries(Object.keys(CLOUD).map(key => [key, 0]));
  const metadata = { app_id: "hapichike", version: 1, backup_created_at: "2026-11-04T00:00:00.000Z", canonical_snapshot: importCore.canonicalizeSnapshot(CLOUD) };
  const base = { viewedChildBalance: zero, households: { status: "ready", items: [{ id: "house-a", membershipRole: "viewer" }] } };
  assert.equal(core.inspect(storage({ [importCore.BACKUP_METADATA_KEY]: JSON.stringify(metadata) }), state(base)).initialImport.readiness.checks.authorizedRole, false);
});

test("Cloud initialized follows sync, nonzero balance and reward log rule", () => {
  assert.equal(core.inspect(storage(), state()).initialImport.readiness.cloudInitialized, true);
  const zero = Object.fromEntries(Object.keys(CLOUD).map(key => [key, 0]));
  assert.equal(core.inspect(storage(), state({ viewedChildBalance: zero })).initialImport.readiness.cloudInitialized, false);
  assert.equal(core.inspect(storage(), state({ viewedChildBalance: zero, viewedChildRewardLogs: [{}] })).initialImport.readiness.cloudInitialized, true);
});

test("Local v1 missing and invalid remain diagnostic inputs", () => {
  assert.equal(core.inspect(new ReadOnlyStorage({ [core.MAPPING_KEY]: mapping() }), state({ local: { legacyStatus: "missing", v2Status: "missing", profileCount: 0 } })).diagnostic.localV1, "missing");
  assert.equal(core.inspect(new ReadOnlyStorage({ [core.V1_KEY]: "{", [core.MAPPING_KEY]: mapping() }), state({ local: { legacyStatus: "invalid", v2Status: "missing", profileCount: 0 } })).diagnostic.localV1, "invalid");
});

test("legacy owner is unknown without explicit mapping", () => {
  const result = core.inspect(storage({ [core.MAPPING_KEY]: null }), state());
  assert.equal(result.localProfile.unresolved, true);
  assert.deepEqual(result.comparison, []);
});

test("migration preview includes target, summaries, secret exclusion and mismatch", () => {
  const s = storage();
  const preview = core.previewLegacy(s, CHILDREN[0], { ...CLOUD, tickets: 99 });
  assert.equal(preview.targetCloudChild.id, "child-a");
  assert.equal(preview.plannedLocalChildKey, "実行時に新規UUIDを生成");
  assert.equal(preview.taskAssignments, 0);
  assert.deepEqual(preview.excludedSecretFields, ["parentPassword"]);
  assert.equal(preview.balanceMismatch, true);
  assert.equal(s.writes, 0);
});

test("backup current, outdated and missing are distinguished", () => {
  const metadata = { app_id: "hapichike", version: 1, backup_created_at: "2020-01-01T00:00:00.000Z", canonical_snapshot: importCore.canonicalizeSnapshot(CLOUD) };
  assert.equal(core.inspect(storage({ [importCore.BACKUP_METADATA_KEY]: JSON.stringify(metadata) }), state()).backup.current, true);
  assert.equal(core.inspect(storage({ [importCore.BACKUP_METADATA_KEY]: JSON.stringify({ ...metadata, canonical_snapshot: "old" }) }), state()).backup.current, false);
  assert.equal(core.inspect(storage(), state()).backup.present, false);
});

test("Local error does not hide Cloud Child details", () => {
  const result = core.inspect(new ReadOnlyStorage(), state({ local: { legacyStatus: "error", v2Status: "error", profileCount: 0 } }));
  assert.equal(result.diagnostic.childDetails, "ready");
  assert.equal(result.selectedChild.id, "child-a");
});

test("Child switch changes management result to viewed Child", () => {
  const a = core.inspect(storage(), state());
  const c = core.inspect(storage({ [core.MAPPING_KEY]: mapping("child-c") }), state({ parentViewedSupabaseChildId: "child-c", viewedChildBalance: { ...CLOUD, tickets: 8 } }));
  assert.equal(a.selectedChild.id, "child-a");
  assert.equal(c.selectedChild.id, "child-c");
  assert.equal(c.comparison[0].cloud, 8);
});

test("read model adapter performs localStorage write 0 and write actions stay in the explicit action module", () => {
  const s = storage();
  core.inspect(s, state());
  assert.equal(s.writes, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "parent", "cloud-management-core.js"), "utf8");
  const actions = fs.readFileSync(path.join(__dirname, "..", "src", "parent", "cloud-management-actions.js"), "utf8");
  assert.doesNotMatch(source, /\.setItem\s*\(|\.removeItem\s*\(|\.rpc\s*\(|\.(?:insert|update|delete)\s*\(/);
  assert.match(actions, /createBackup|applyMigration|saveMapping|createImportPreview/);
  assert.doesNotMatch(actions, /\.(?:insert|update|delete)\s*\(|service.?role/i);
});

test("browser bundle用UMD分岐はrequire未定義でもCommonJS側へ入らない", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "parent", "cloud-management-core.js"), "utf8");
  const context = {
    globalThis: {
      HapichikeCloudMapping: mappingCore,
      HapichikeChildIdentity: require("../src/child-identity-core.js"),
      HapichikeInitialImport: importCore,
      HapichikeProfileMigration: require("../src/profile-migration.js"),
    },
    module: { exports: {} },
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.module.exports.inspect, "function");
});
