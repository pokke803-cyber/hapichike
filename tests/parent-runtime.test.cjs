const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createParentRuntime } = require("../src/parent/parent-runtime.js");

const householdA = { id: "household-a", name: "A" };
const householdB = { id: "household-b", name: "B" };
const childA = { id: "child-a", household_id: "household-a", name: "A", display_order: 2 };
const childC = { id: "child-c", household_id: "household-a", name: "C", display_order: 1 };
const childB = { id: "child-b", household_id: "household-b", name: "B", display_order: 1 };

function setup(options = {}) {
  const calls = [];
  const writes = [];
  let authCallback = null;
  const storageValues = options.storageValues ?? {};
  const dependencies = {
    authApi: {
      getParentSession: async () => {
        calls.push("auth");
        if (options.authImpl) return options.authImpl();
        if (options.authError) throw new Error("auth SQL token");
        return { session: options.session === undefined ? { user: { id: "parent-a", email: "a@example.test" } } : options.session };
      },
      onParentAuthStateChange: callback => { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    householdsApi: {
      getCurrentHouseholds: async userId => {
        calls.push(`households:${userId}`);
        if (options.householdImpl) return options.householdImpl(userId);
        if (options.householdError) throw new Error("household failure");
        return options.households ?? [householdA];
      },
    },
    childrenApi: {
      getChildrenByHousehold: async householdId => {
        calls.push(`children:${householdId}`);
        if (options.childrenImpl) return options.childrenImpl(householdId);
        if (options.childError) throw new Error("child failure");
        return options.children ?? (householdId === "household-b" ? [childB] : [childA, childC]);
      },
    },
    rewardsApi: {
      getChildBalances: async childId => {
        calls.push(`balance:${childId}`);
        if (options.detailsError) throw new Error("details failure");
        if (options.balanceImpl) return options.balanceImpl(childId);
        return { child_id: childId, tickets: childId === "child-a" ? 1 : 3 };
      },
    },
    historyApi: {
      getRecentRewardLogs: async childId => { calls.push(`logs:${childId}`); return [{ id: `log-${childId}` }]; },
    },
    storage: {
      getItem(key) {
        calls.push(`get:${key}`);
        if (options.storageErrorKeys?.includes(key)) throw new Error("storage read failure");
        return storageValues[key] ?? null;
      },
      setItem(...args) { writes.push(["setItem", ...args]); },
      removeItem(...args) { writes.push(["removeItem", ...args]); },
      clear(...args) { writes.push(["clear", ...args]); },
    },
    parsers: {
      parseLegacy: raw => {
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
        return value;
      },
      parseV2: raw => {
        const value = JSON.parse(raw);
        if (value.version !== 2 || !value.profiles) throw new Error("invalid");
        return value;
      },
    },
    requestTimeoutMs: options.requestTimeoutMs ?? 100,
  };
  return { runtime: createParentRuntime(dependencies), calls, writes, emitAuth: session => authCallback?.("SIGNED_IN", session) };
}

test("initialize signed_outはCloud SELECTを実行せずLocal readだけ行う", async () => {
  const { runtime, calls } = setup({ session: null });
  await runtime.initializeParentRuntime();
  assert.equal(runtime.getState().auth.status, "signed_out");
  assert.equal(calls.some(call => call.startsWith("households:")), false);
  assert.deepEqual(calls.filter(call => call.startsWith("get:")), ["get:kidsVegasCasino.v1", "get:kidsVegasCasino.v2"]);
});

test("Parent A initializeはAuth→Household→Child→Localの順でA/Cをdisplay_order表示する", async () => {
  const { runtime, calls } = setup();
  await runtime.initializeParentRuntime();
  assert.deepEqual(calls.slice(0, 3), ["auth", "households:parent-a", "children:household-a"]);
  assert.deepEqual(runtime.getState().cloudChildren.items.map(item => item.id), ["child-c", "child-a"]);
  assert.equal(runtime.getState().parentViewedSupabaseChildId, null);
  assert.ok(calls.indexOf("get:kidsVegasCasino.v1") > calls.indexOf("children:household-a"));
});

test("Child A/C選択はviewed Childだけを変え、残高とreward logsを取得・refreshする", async () => {
  const key = "11111111-1111-4111-8111-111111111111";
  const { runtime, calls } = setup({ storageValues: {
    "kidsVegasCasino.v2": JSON.stringify({ version: 2, activeLocalChildKey: key, profiles: { [key]: {} } }),
  } });
  await runtime.initializeParentRuntime();
  await runtime.selectViewedCloudChild("child-a");
  assert.equal(runtime.getState().viewedChildBalance.tickets, 1);
  assert.equal(runtime.getState().local.activeLocalChildKey, key);
  await runtime.selectViewedCloudChild("child-c");
  await runtime.refreshViewedChildData();
  assert.equal(runtime.getState().parentViewedSupabaseChildId, "child-c");
  assert.equal(runtime.getState().viewedChildBalance.tickets, 3);
  assert.equal(calls.filter(call => call === "balance:child-c").length, 2);
  assert.equal(calls.filter(call => call === "logs:child-c").length, 2);
});

test("Household変更はstale Child詳細を解除し、Parent BではChild Bだけを許可する", async () => {
  const { runtime } = setup({ households: [householdA, householdB] });
  await runtime.initializeParentRuntime();
  assert.equal(runtime.getState().selectedHouseholdId, null);
  await runtime.selectHousehold("household-a");
  await runtime.selectViewedCloudChild("child-a");
  await runtime.selectHousehold("household-b");
  assert.deepEqual(runtime.getState().cloudChildren.items.map(item => item.id), ["child-b"]);
  assert.equal(runtime.getState().parentViewedSupabaseChildId, null);
  assert.equal(runtime.getState().viewedChildBalance, null);
  await assert.rejects(() => runtime.selectViewedCloudChild("child-a"), error => error.code === "CHILD_SELECTION_INVALID");
  await assert.rejects(() => runtime.selectViewedCloudChild("child-c"), error => error.code === "CHILD_SELECTION_INVALID");
});

test("Local v1/v2 missingまたはinvalidでもCloud dashboardはreadyになる", async () => {
  for (const storageValues of [{}, { "kidsVegasCasino.v1": "{", "kidsVegasCasino.v2": "{" }]) {
    const { runtime } = setup({ storageValues });
    await runtime.initializeParentRuntime();
    assert.equal(runtime.getState().cloudChildren.status, "ready");
    assert.ok(["missing", "invalid"].includes(runtime.getState().local.legacyStatus));
    assert.ok(["missing", "invalid"].includes(runtime.getState().local.v2Status));
  }
});

test("Household/Child/details errorは安全codeへ変換し、古い詳細を表示しない", async () => {
  const householdFailure = setup({ householdError: true }).runtime;
  await householdFailure.initializeParentRuntime();
  assert.equal(householdFailure.getState().households.errorCode, "HOUSEHOLD_LOAD_FAILED");
  const childFailure = setup({ childError: true }).runtime;
  await childFailure.initializeParentRuntime();
  assert.equal(childFailure.getState().cloudChildren.errorCode, "CHILD_LOAD_FAILED");
  const detailsFailure = setup({ detailsError: true }).runtime;
  await detailsFailure.initializeParentRuntime();
  await detailsFailure.selectViewedCloudChild("child-a");
  assert.equal(detailsFailure.getState().viewedChildData.errorCode, "CHILD_LOAD_FAILED");
  assert.equal(detailsFailure.getState().viewedChildBalance, null);
  assert.deepEqual(detailsFailure.getState().viewedChildRewardLogs, []);
  assert.doesNotMatch(JSON.stringify(detailsFailure.getState()), /SQL token|stack|details failure/i);
});

test("Child切替中のstale詳細responseは現在のChildを上書きしない", async () => {
  let resolveChildA;
  const childABalance = new Promise(resolve => { resolveChildA = resolve; });
  const { runtime } = setup({ balanceImpl: childId => childId === "child-a"
    ? childABalance : Promise.resolve({ child_id: childId, tickets: 3 }) });
  await runtime.initializeParentRuntime();
  const pendingA = runtime.selectViewedCloudChild("child-a");
  await Promise.resolve();
  await runtime.selectViewedCloudChild("child-c");
  resolveChildA({ child_id: "child-a", tickets: 99 });
  await pendingA;
  assert.equal(runtime.getState().parentViewedSupabaseChildId, "child-c");
  assert.deepEqual(runtime.getState().viewedChildBalance, { child_id: "child-c", tickets: 3 });
});

test("明示refreshはChildrenとLocalを再読込し、token/sessionを公開stateへ保持しない", async () => {
  const { runtime, calls } = setup();
  await runtime.initializeParentRuntime();
  await runtime.refreshCloudChildren();
  await runtime.readLocalIdentityState();
  assert.equal(calls.filter(call => call === "children:household-a").length, 2);
  assert.equal(calls.filter(call => call === "get:kidsVegasCasino.v1").length, 2);
  assert.doesNotMatch(JSON.stringify(runtime.getState()), /token|secret|session/i);
});

test("P1 adapterはlocalStorage write 0、Cloud write API/RPC参照0", async () => {
  const { runtime, writes } = setup();
  await runtime.initializeParentRuntime();
  await runtime.selectViewedCloudChild("child-a");
  assert.equal(writes.length, 0);
  const source = fs.readFileSync(path.join(__dirname, "../src/parent/parent-runtime.js"), "utf8");
  assert.doesNotMatch(source, /(?:localStorage|storage)[\s\S]{0,20}\.(?:setItem|removeItem|clear)\(|\.rpc\(|\.insert\(/i);
  assert.doesNotMatch(source, /createHousehold|createChild|addTicket|importInitial/i);
  const uiSource = fs.readFileSync(path.join(__dirname, "../parent/parent.js"), "utf8");
  assert.doesNotMatch(uiSource, /import \* as (?:householdsApi|childrenApi|rewardsApi|historyApi)/);
});

test("全体loadingはsigned_out/auth・Household・Child error/emptyとLocal異常でも必ず終了する", async () => {
  const cases = [
    [{ session: null }, "signed_out"],
    [{ authError: true }, "error"],
    [{ households: [] }, "empty"],
    [{ householdError: true }, "error"],
    [{ children: [] }, "empty"],
    [{ childError: true }, "error"],
    [{ storageValues: {} }, "success"],
    [{ storageValues: { "kidsVegasCasino.v1": "{", "kidsVegasCasino.v2": "{" } }, "success"],
    [{ storageErrorKeys: ["kidsVegasCasino.v1", "kidsVegasCasino.v2"] }, "success"],
  ];
  for (const [options, expected] of cases) {
    const runtime = setup(options).runtime;
    await runtime.initializeParentRuntime();
    assert.equal(runtime.getState().runtime.status, expected);
    assert.notEqual(runtime.getState().runtime.status, "loading");
  }
  const localError = setup({ storageErrorKeys: ["kidsVegasCasino.v1", "kidsVegasCasino.v2"] }).runtime;
  await localError.initializeParentRuntime();
  assert.equal(localError.getState().local.legacyStatus, "error");
  assert.equal(localError.getState().local.v2Status, "error");
});

test("Parent A/B正常初期化とdetails error分離は全体loadingを残さない", async () => {
  const parentA = setup().runtime;
  await parentA.initializeParentRuntime();
  assert.equal(parentA.getState().runtime.status, "success");
  assert.deepEqual(parentA.getState().cloudChildren.items.map(item => item.id), ["child-c", "child-a"]);

  const parentB = setup({
    session: { user: { id: "parent-b", email: "b@example.test" } },
    households: [householdB],
  }).runtime;
  await parentB.initializeParentRuntime();
  assert.equal(parentB.getState().runtime.status, "success");
  assert.deepEqual(parentB.getState().cloudChildren.items.map(item => item.id), ["child-b"]);

  const detailsFailure = setup({ detailsError: true }).runtime;
  await detailsFailure.initializeParentRuntime();
  await detailsFailure.selectViewedCloudChild("child-a");
  assert.equal(detailsFailure.getState().runtime.status, "success");
  assert.equal(detailsFailure.getState().viewedChildData.status, "error");
  assert.equal(detailsFailure.getState().cloudChildren.status, "ready");
});

test("initialize二重実行・retry・未解決Promiseでstale結果やloadingを残さない", async () => {
  let resolveFirst;
  let authCalls = 0;
  const firstSession = new Promise(resolve => { resolveFirst = resolve; });
  const { runtime } = setup({
    authImpl: () => (++authCalls === 1
      ? firstSession
      : Promise.resolve({ session: { user: { id: "parent-b", email: "b@example.test" } } })),
    householdImpl: userId => userId === "parent-b" ? [householdB] : [householdA],
  });
  const staleInitialize = runtime.initializeParentRuntime();
  const currentInitialize = runtime.initializeParentRuntime();
  await currentInitialize;
  resolveFirst({ session: { user: { id: "parent-a", email: "a@example.test" } } });
  await staleInitialize;
  assert.equal(runtime.getState().auth.userId, "parent-b");
  assert.deepEqual(runtime.getState().cloudChildren.items.map(item => item.id), ["child-b"]);
  assert.equal(runtime.getState().runtime.status, "success");

  let retryCalls = 0;
  const retryRuntime = setup({ authImpl: () => {
    retryCalls += 1;
    if (retryCalls === 1) throw new Error("temporary auth failure");
    return { session: { user: { id: "parent-a" } } };
  } }).runtime;
  await retryRuntime.initializeParentRuntime();
  assert.equal(retryRuntime.getState().runtime.status, "error");
  await retryRuntime.initializeParentRuntime();
  assert.equal(retryRuntime.getState().runtime.status, "success");

  const timeoutRuntime = setup({ authImpl: () => new Promise(() => {}), requestTimeoutMs: 5 }).runtime;
  await timeoutRuntime.initializeParentRuntime();
  assert.equal(timeoutRuntime.getState().runtime.status, "error");
});

test("browser bundle用UMD分岐はrequire未定義でもCommonJS側へ入らない", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/parent/parent-runtime.js"), "utf8");
  const context = {
    globalThis: { HapichikeParentRuntimeCore: require("../src/parent/parent-runtime-core.js") },
    module: { exports: {} },
    queueMicrotask,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.module.exports.createParentRuntime, "function");
});
