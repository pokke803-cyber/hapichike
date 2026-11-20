const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/online-rewards-core.js");

const identity = { localChildKey: "local-a", supabaseChildId: "11111111-1111-4111-8111-111111111111", householdId: "house-a" };
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = () => new Date("2026-11-10T00:00:00.000Z");

test("reward eventはv2 identity・eventId・action・amount・createdAtを保持", () => {
  const event = core.createRewardEvent({ ...identity, actionType: "ticket", amount: 1, operationKey: "ticket", eventId: uuid }, { now });
  assert.deepEqual(event, { eventId: uuid, ...identity, actionType: "ticket", amount: 1, payType: null,
    source: "hapichike_ui", operationKey: "ticket", createdAt: "2026-11-10T00:00:00.000Z", status: "cloud_pending" });
});

test("ticket/star/exchange/PAY/happy chanceを検証する", () => {
  for (const input of [
    { actionType: "ticket", amount: 1 }, { actionType: "star_coin", amount: -1 },
    { actionType: "star_exchange", amount: 1 }, { actionType: "pay", payType: "sweets", amount: 1 },
    { actionType: "happy_chance", amount: -1 },
  ]) assert.doesNotThrow(() => core.createRewardEvent({ ...identity, ...input, eventId: uuid }, { now }));
  assert.throws(() => core.createRewardEvent({ ...identity, actionType: "pay", payType: "snack", amount: 1, eventId: uuid }), /PAY/);
});

test("eventIdはUUID v4だけを許可する", () => {
  assert.equal(core.isUuidV4(uuid), true);
  assert.throws(() => core.createRewardEvent({ ...identity, actionType: "ticket", amount: 1, eventId: "bad" }), /UUID v4/);
});

test("pending event stateを検証してround tripする", () => {
  const event = core.createRewardEvent({ ...identity, actionType: "ticket", amount: 1, eventId: uuid }, { now });
  const document = core.upsertEvent(core.emptyEventDocument(), event);
  assert.deepEqual(core.parseEventDocument(JSON.stringify(document)), document);
  assert.deepEqual(core.removeEvent(document, uuid), core.emptyEventDocument());
});

test("同じ操作のretryは同じeventIdを再利用する", () => {
  const input = { ...identity, actionType: "ticket", amount: 1 };
  const event = core.createRewardEvent({ ...input, operationKey: "task:a", eventId: uuid }, { now });
  assert.equal(core.findRetryEvent(core.upsertEvent(core.emptyEventDocument(), event), "task:a", input).eventId, uuid);
});

test("mapping変更後の古いpending eventはstaleとして拒否する", () => {
  const event = core.createRewardEvent({ ...identity, actionType: "ticket", amount: 1, operationKey: "task:a", eventId: uuid }, { now });
  const document = core.upsertEvent(core.emptyEventDocument(), event);
  assert.throws(() => core.findRetryEvent(document, "task:a", { ...identity, supabaseChildId: "child-c", actionType: "ticket", amount: 1 }), /STALE/);
});

test("cloud success後はlocal_pendingとして保存できる", () => {
  const event = core.createRewardEvent({ ...identity, actionType: "ticket", amount: 1, eventId: uuid }, { now });
  const document = core.upsertEvent(core.emptyEventDocument(), { ...event, status: "local_pending" });
  assert.equal(core.parseEventDocument(JSON.stringify(document)).events[0].status, "local_pending");
});

test("RPC resultのchild_id不一致はLocal反映前に拒否する", () => {
  assert.equal(core.assertRpcResultChild({ child_id: identity.supabaseChildId }, identity.supabaseChildId).child_id, identity.supabaseChildId);
  assert.throws(() => core.assertRpcResultChild({ child_id: "child-c" }, identity.supabaseChildId), /RPC_CHILD_MISMATCH/);
});

test("同じactionの並列送信を拒否し失敗後はretry可能", async () => {
  let release;
  const first = core.withActionLock("ticket", () => new Promise(resolve => { release = resolve; }));
  assert.deepEqual(await core.withActionLock("ticket", async () => "second"), { duplicate: true });
  release("first");
  assert.equal(await first, "first");
  await assert.rejects(() => core.withActionLock("ticket", async () => { throw new Error("rpc failed"); }), /rpc failed/);
  assert.equal(await core.withActionLock("ticket", async () => "retry"), "retry");
});

test("browser bridgeはactive v2 resolverと005 RPC wrapperだけを使う", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/online-rewards.js"), "utf8");
  assert.match(source, /resolveRewardChild\(localStorage\)/);
  for (const name of ["addTicket", "addStarCoin", "exchangeStarCoinsForTicket", "adjustPayBalance", "adjustHappyChance"]) assert.match(source, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(source, /cloudMapping\.v1|LOCAL_CHILD_KEY|parentViewedSupabaseChildId/);
});

test("Cloud成功後はserver全残高上書きせずevent deltaをLocalへ適用する", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/online-rewards.js"), "utf8");
  assert.match(source, /applyRewardEvent/);
  assert.doesNotMatch(source, /applyServerBalance|getChildBalances/);
});

test("idempotency migrationはevent_id primary keyと既存RPC overloadを持つ", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/202611100007_reward_event_idempotency.sql"), "utf8");
  assert.match(sql, /event_id uuid primary key/);
  assert.match(sql, /on conflict \(event_id\) do nothing/);
  for (const name of ["add_ticket", "add_star_coin", "exchange_star_coins_for_ticket", "adjust_pay_balance", "adjust_happy_chance"]) assert.match(sql, new RegExp(`create function public\\.${name}`));
});

test("initial import・legacy migration・service roleへ接続しない", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/online-rewards.js"), "utf8");
  assert.doesNotMatch(source, /importInitialHapichikeSnapshot|identityMigration|service.?role/i);
});
