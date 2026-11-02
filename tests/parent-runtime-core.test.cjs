const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/parent/parent-runtime-core.js");

const householdA = { id: "household-a", name: "A" };
const householdB = { id: "household-b", name: "B" };
const childA = { id: "child-a", household_id: "household-a", name: "同じ名前", display_order: 1 };
const childC = { id: "child-c", household_id: "household-a", name: "同じ名前", display_order: 2 };
const childB = { id: "child-b", household_id: "household-b", name: "B", display_order: 1 };

function signedInState(userId = "parent-a") {
  return core.applySignedIn(core.createParentRuntimeState(), userId);
}

function householdState(households = [householdA]) {
  return core.applyHouseholdsLoaded(signedInState(), households);
}

function childState(children = [childA, childC]) {
  return core.applyCloudChildrenLoaded(householdState(), children);
}

test("1 signed_outはCloud scopeとuserIdを消す", () => {
  const state = core.applySignedOut(signedInState());
  assert.equal(state.auth.status, "signed_out");
  assert.equal(state.auth.userId, null);
  assert.equal(state.cloudChildren.status, "not_loaded");
});

test("2 signed_inはuserIdだけを公開しtokenを保持しない", () => {
  const state = signedInState();
  assert.deepEqual(state.auth, { status: "signed_in", userId: "parent-a", errorCode: null });
  assert.doesNotMatch(JSON.stringify(state), /token|secret|session/i);
});

test("3 household 0件はemptyでChild取得へ進めない", () => {
  const state = core.applyHouseholdsLoaded(signedInState(), []);
  assert.equal(state.households.status, "empty");
  assert.throws(() => core.startCloudChildrenLoad(state), error => error.code === "HOUSEHOLD_NOT_FOUND");
});

test("4 household 1件はIDで自動選択する", () => {
  const state = householdState();
  assert.equal(state.selectedHouseholdId, "household-a");
});

test("5 household複数件はParent明示選択を要求する", () => {
  const state = householdState([householdA, householdB]);
  assert.equal(state.selectedHouseholdId, null);
  assert.equal(core.selectHousehold(state, "household-b").selectedHouseholdId, "household-b");
});

test("6 Child 0件はemptyで選択を持たない", () => {
  const state = core.applyCloudChildrenLoaded(householdState(), []);
  assert.equal(state.cloudChildren.status, "empty");
  assert.equal(state.parentViewedSupabaseChildId, null);
});

test("7 Parent AはChild A/Cを最小read modelで取得する", () => {
  const state = childState();
  assert.deepEqual(state.cloudChildren.items.map(child => child.id), ["child-a", "child-c"]);
  assert.deepEqual(Object.keys(state.cloudChildren.items[0]), ["id", "householdId", "displayName", "displayOrder"]);
});

test("8 Parent BはHousehold BのChild Bだけを取得する", () => {
  let state = householdState([householdA, householdB]);
  state = core.selectHousehold(state, "household-b");
  state = core.applyCloudChildrenLoaded(state, [childB]);
  assert.deepEqual(state.cloudChildren.items.map(child => child.id), ["child-b"]);
});

test("9 viewed ChildはIDで明示選択する", () => {
  const state = core.selectViewedCloudChild(childState(), "child-c");
  assert.equal(state.parentViewedSupabaseChildId, "child-c");
});

test("10 一覧外Child選択を拒否する", () => {
  assert.throws(() => core.selectViewedCloudChild(childState(), "child-b"), error => error.code === "CHILD_SELECTION_INVALID");
});

test("11 Household変更でstale Childと詳細を解除する", () => {
  let state = core.selectViewedCloudChild(childState(), "child-a");
  state = core.applyViewedChildData(state, "child-a", { tickets: 1 }, [{ id: "log" }]);
  state = core.applyHouseholdsLoaded(state, [householdA, householdB]);
  state = core.selectHousehold(state, "household-b");
  assert.equal(state.parentViewedSupabaseChildId, null);
  assert.equal(state.viewedChildBalance, null);
  assert.deepEqual(state.viewedChildRewardLogs, []);
});

test("12 display name重複でもChild IDで区別する", () => {
  let state = core.selectViewedCloudChild(childState(), "child-c");
  assert.equal(state.cloudChildren.items[0].displayName, state.cloudChildren.items[1].displayName);
  assert.equal(state.parentViewedSupabaseChildId, "child-c");
});

test("13 activeLocalChildKeyとCloud Childは独立して更新される", () => {
  const localKey = "11111111-1111-4111-8111-111111111111";
  let state = childState();
  state = core.applyLocalIdentityState(state, {
    legacyStatus: "missing", v2Status: "success", activeLocalChildKey: localKey,
    activeLocalChildExists: true, errorCodes: [],
  });
  state = core.selectViewedCloudChild(state, "child-a");
  assert.equal(state.local.activeLocalChildKey, localKey);
  state = core.resetViewedChild(state);
  assert.equal(state.local.activeLocalChildKey, localKey);
});

test("14 Local missingでもCloud Child取得を継続できる", () => {
  let state = core.applyLocalIdentityState(householdState(), core.readLocalIdentityState({ legacyRaw: null, v2Raw: null }));
  state = core.applyCloudChildrenLoaded(state, [childA]);
  assert.equal(state.local.v2Status, "missing");
  assert.equal(state.cloudChildren.status, "ready");
});

test("15 Cloud errorとLocal errorは独立する", () => {
  let state = core.applyLocalIdentityState(householdState(), core.readLocalIdentityState({ legacyRaw: "{", v2Raw: "{" }));
  state = core.applyCloudChildrenError(state);
  assert.equal(state.cloudChildren.errorCode, "CHILD_LOAD_FAILED");
  assert.deepEqual(state.local.errorCodes, ["LOCAL_V1_INVALID", "LOCAL_V2_INVALID"]);
});

test("16 mappingなしでもCloud Child一覧を取得する", () => {
  const state = childState();
  assert.equal(state.cloudChildren.status, "ready");
  assert.equal(state.cloudChildren.items.length, 2);
});

test("17 cross-household Child結果を拒否する", () => {
  assert.throws(() => core.applyCloudChildrenLoaded(householdState(), [childB]), error => error.code === "CHILD_SELECTION_INVALID");
});

test("18 fail closedはauth/household/Child/mapping/Local/connectionを検査する", () => {
  let state = core.selectViewedCloudChild(childState(), "child-a");
  let gate = core.getCloudWriteGate(state, { requiresMapping: true, mappingStatus: "missing", requiresLocalIdentity: true });
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.reasons, ["MAPPING_REQUIRED", "LOCAL_V2_INVALID"]);
  state = core.applyCloudChildrenError(state);
  gate = core.getCloudWriteGate(state);
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes("CONNECTION_FAILED"));
});

test("19 技術例外を安定error codeへ変換する", () => {
  const error = new Error("SQL token stack should not escape");
  assert.equal(core.toParentRuntimeErrorCode(error, "children"), "CHILD_LOAD_FAILED");
  assert.equal(core.toParentRuntimeErrorCode(error, "local_v1"), "LOCAL_V1_INVALID");
});

test("20 core stateはtoken/secret/sessionを保持せずwrite APIを含まない", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/parent/parent-runtime-core.js"), "utf8");
  const state = signedInState();
  assert.doesNotMatch(JSON.stringify(state), /token|secret|session/i);
  assert.doesNotMatch(source, /localStorage\.(?:setItem|removeItem|clear)|supabase\.(?:from|rpc)|\.insert\(|\.update\(|\.delete\(/i);
  assert.deepEqual(core.RUNTIME_ACTIONS, [
    "initializeParentRuntime", "selectHousehold", "selectViewedCloudChild", "refreshCloudChildren",
    "refreshViewedChildData", "readLocalIdentityState", "resetViewedChild",
  ]);
});

test("Local read contractはv1/v2のsuccess/missing/invalidとactive key存在だけを返す", () => {
  const key = "11111111-1111-4111-8111-111111111111";
  const result = core.readLocalIdentityState({
    legacyRaw: "{}",
    v2Raw: JSON.stringify({ version: 2, appId: "hapichike", activeLocalChildKey: key, profiles: { [key]: {} } }),
  });
  assert.deepEqual(result, {
    legacyStatus: "success", v2Status: "success", activeLocalChildKey: key,
    activeLocalChildExists: true, profileCount: 1, errorCodes: [],
  });
});

test("Child詳細はloadingで旧値を消し、errorでもfail closedを維持する", () => {
  let state = core.selectViewedCloudChild(childState(), "child-a");
  state = core.applyViewedChildData(state, "child-a", { tickets: 2 }, [{ id: "old" }]);
  state = core.startViewedChildDataLoad(state);
  assert.equal(state.viewedChildData.status, "loading");
  assert.equal(state.viewedChildBalance, null);
  assert.deepEqual(state.viewedChildRewardLogs, []);
  state = core.applyViewedChildDataError(state);
  assert.equal(state.viewedChildData.status, "error");
  assert.equal(state.viewedChildBalance, null);
  assert.deepEqual(state.viewedChildRewardLogs, []);
});

test("pure coreは入力stateを変更しない", () => {
  const before = childState();
  const snapshot = JSON.stringify(before);
  core.selectViewedCloudChild(before, "child-a");
  assert.equal(JSON.stringify(before), snapshot);
});
