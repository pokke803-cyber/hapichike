import "./online-rewards-core.js";
import { getParentSession, getParentUser } from "./services/api/authApi.js";
import { getCurrentHouseholds } from "./services/api/householdsApi.js";
import { getChildrenByHousehold } from "./services/api/childrenApi.js";
import { addTicket, addStarCoin, exchangeStarCoinsForTicket, adjustPayBalance, adjustHappyChance, getChildAppSyncState } from "./services/api/rewardsApi.js";

const core = window.HapichikeOnlineRewardsCore;
const localState = window.HapichikeLocalState;

function safeMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/mapping|stale|household|child_mismatch/.test(message)) return "子どものクラウド対応付けを、おうちの人に確認してね。";
  if (/activation|v2_invalid|active/.test(message)) return "子どものデータ設定を、おうちの人に確認してね。";
  if (/session|jwt|refresh token/.test(message)) return "ログインの有効期限が切れました。おうちの人に確認してね。";
  if (/fetch|network|offline|timeout|connection/.test(message)) return "通信できませんでした。もう一度試してください。";
  if (/not authorized|permission|row-level security/.test(message)) return "このデータは変更できません。おうちの人に確認してね。";
  return "同期できませんでした。もう一度試してください。";
}

function readEvents() { return core.parseEventDocument(localStorage.getItem(core.EVENT_STORAGE_KEY)); }
function writeEvents(document) {
  const raw = JSON.stringify(document);
  localStorage.setItem(core.EVENT_STORAGE_KEY, raw);
  if (localStorage.getItem(core.EVENT_STORAGE_KEY) !== raw) throw new Error("reward event state write failed");
}

async function resolveRewardChild() {
  const local = localState.resolveRewardChild(localStorage);
  if (!local.cloudReady) throw new Error(local.reason || "MAPPING_INVALID");
  if (navigator.onLine === false) throw new Error("offline");
  const { session } = await getParentSession();
  if (!session?.user) throw new Error("session_missing");
  const { user } = await getParentUser();
  if (!user || user.id !== session.user.id) throw new Error("session_missing");
  const households = await getCurrentHouseholds(session.user.id);
  if (!households.some(item => item.id === local.householdId)) throw new Error("HOUSEHOLD_MISMATCH");
  const children = await getChildrenByHousehold(local.householdId);
  if (!children.some(item => item.id === local.supabaseChildId && (item.household_id || item.householdId) === local.householdId)) {
    throw new Error("MAPPING_STALE");
  }
  const syncState = await getChildAppSyncState(local.supabaseChildId, core.APP_ID);
  if (!syncState || syncState.app_id !== core.APP_ID || !syncState.initial_import_completed_at) throw new Error("INITIAL_IMPORT_INCOMPLETE");
  return local;
}

async function callRpc(event, options) {
  const logOptions = { title: options.title ?? null, message: options.message ?? null,
    metadata: { source: event.source, created_at: event.createdAt, ...(options.metadata ?? {}) } };
  if (event.actionType === "ticket") return addTicket(event.supabaseChildId, event.amount, event.eventId, logOptions);
  if (event.actionType === "star_coin") return addStarCoin(event.supabaseChildId, event.amount, event.eventId, logOptions);
  if (event.actionType === "star_exchange") return exchangeStarCoinsForTicket(event.supabaseChildId, event.eventId, logOptions);
  if (event.actionType === "pay") return adjustPayBalance(event.supabaseChildId, event.payType, event.amount, event.eventId, logOptions);
  if (event.actionType === "happy_chance") return adjustHappyChance(event.supabaseChildId, event.amount, event.eventId, logOptions);
  throw new Error("unsupported reward event");
}

function applyLocalAndFinish(event) {
  const result = localState.applyRewardEvent(localStorage, event);
  writeEvents(core.removeEvent(readEvents(), event.eventId));
  return result;
}

async function commit(options) {
  const identity = await resolveRewardChild();
  const operationKey = options.lockKey || `${options.type}:${options.category || ""}:${options.source || ""}`;
  const input = { ...identity, actionType: options.actionType || options.type, amount: options.amount,
    payType: options.payType || options.category || null, operationKey, source: options.source };
  let document = readEvents();
  let event = core.findRetryEvent(document, operationKey, input);
  if (event?.status === "local_pending") {
    const localApply = applyLocalAndFinish(event);
    return { mode: "cloud", event, localChildKey: event.localChildKey, localApply, recovered: true };
  }
  if (!event) {
    event = core.createRewardEvent(input);
    document = core.upsertEvent(document, event);
    writeEvents(document);
  }
  const rpcResult = await callRpc(event, options);
  core.assertRpcResultChild(rpcResult, event.supabaseChildId);
  event = { ...event, status: "local_pending" };
  writeEvents(core.upsertEvent(readEvents(), event));
  const localApply = applyLocalAndFinish(event);
  return { mode: "cloud", event, localChildKey: event.localChildKey, localApply };
}

async function mutate(options) {
  const key = options.lockKey || `${options.type}:${options.category || ""}:${options.source || ""}`;
  return core.withActionLock(key, async () => {
    try { return await commit(options); }
    catch (error) { return { mode: "error", error, message: safeMessage(error) }; }
  });
}

function repairPendingLocalApplies() {
  let repaired = 0;
  const document = readEvents();
  for (const event of document.events.filter(item => item.status === "local_pending")) {
    applyLocalAndFinish(event);
    repaired += 1;
  }
  return repaired;
}

function getDiagnostics() {
  let resolver;
  try { resolver = localState.resolveRewardChild(localStorage); } catch (error) { resolver = { cloudReady: false, reason: error.message }; }
  let events = [];
  try { events = readEvents().events; } catch {}
  return { activeLocalChildKey: resolver.localChildKey || null, mappedCloudChildId: resolver.supabaseChildId || null,
    resolverValid: resolver.cloudReady === true, resolverReason: resolver.reason || null,
    pendingRewardEventCount: events.length, localPendingCount: events.filter(item => item.status === "local_pending").length };
}

try { repairPendingLocalApplies(); } catch {}
window.HapichikeOnlineRewards = Object.freeze({ mutate, repairPendingLocalApplies, getDiagnostics });
