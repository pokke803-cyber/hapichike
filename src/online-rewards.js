import "./online-rewards-core.js";
import { getParentSession, getParentUser } from "./services/api/authApi.js";
import { getCurrentHouseholds } from "./services/api/householdsApi.js";
import { getChildrenByHousehold } from "./services/api/childrenApi.js";
import {
  addTicket,
  addStarCoin,
  exchangeStarCoinsForTicket,
  adjustPayBalance,
  adjustHappyChance,
  getChildBalances,
  getChildAppSyncState,
} from "./services/api/rewardsApi.js";

const core = window.HapichikeOnlineRewardsCore;
const mappingCore = window.HapichikeCloudMapping;

function safeMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/session|jwt|refresh token/.test(message)) return "ログインの有効期限が切れました。おうちの人に確認してね。";
  if (/fetch|network|offline|timeout|connection/.test(message)) return "通信できませんでした。もう一度ためしてね。";
  if (/not authorized|permission|row-level security/.test(message)) return "このデータは変更できません。おうちの人に確認してね。";
  if (/required|negative|invalid|balance/.test(message)) return "残高を確認して、もう一度ためしてね。";
  return "同期できませんでした。もう一度ためしてね。";
}

async function resolveMode() {
  const document = mappingCore.readMapping(localStorage);
  const mapping = document.mappings.find(item => item.localChildKey === mappingCore.LOCAL_CHILD_KEY) ?? null;
  if (!mapping) return { mode: "local", reason: "mapping_missing" };

  if (navigator.onLine === false) return { mode: "blocked", reason: "offline" };
  const { session } = await getParentSession();
  if (!session?.user) return core.evaluateCloudReady({ mapping, session, networkAvailable: true });
  const { user } = await getParentUser();
  if (!user || user.id !== session.user.id) return core.evaluateCloudReady({ mapping, session: null, networkAvailable: true });

  const households = await getCurrentHouseholds(session.user.id);
  const householdValid = households.some(item => item.id === mapping.householdId);
  if (!householdValid) return core.evaluateCloudReady({ mapping, session, networkAvailable: true, householdValid: false });

  const children = await getChildrenByHousehold(mapping.householdId);
  const childVisible = children.some(item => item.id === mapping.supabaseChildId && item.household_id === mapping.householdId);
  if (!childVisible) return core.evaluateCloudReady({ mapping, session, networkAvailable: true, householdValid: true, childVisible: false });

  const syncState = await getChildAppSyncState(mapping.supabaseChildId, core.APP_ID);
  return core.evaluateCloudReady({
    mapping,
    session,
    networkAvailable: true,
    householdValid: true,
    childVisible: true,
    syncStateLoaded: true,
    syncState,
  });
}

async function callRpc(event, options) {
  const logOptions = {
    title: options.title ?? null,
    message: options.message ?? null,
    metadata: { source: event.source, created_at: event.created_at, ...(options.metadata ?? {}) },
  };
  if (event.type === "ticket") return addTicket(event.child_id, event.amount, logOptions);
  if (event.type === "star_coin") return addStarCoin(event.child_id, event.amount, logOptions);
  if (event.type === "star_exchange") return exchangeStarCoinsForTicket(event.child_id, logOptions);
  if (event.type === "pay") return adjustPayBalance(event.child_id, event.category, event.amount, logOptions);
  if (event.type === "happy_chance") return adjustHappyChance(event.child_id, event.amount, logOptions);
  throw new Error("unsupported reward event");
}

async function mutate(options) {
  const key = options.lockKey || `${options.type}:${options.category || ""}:${options.source || ""}`;
  return core.withActionLock(key, async () => {
    try {
      const readiness = await resolveMode();
      if (readiness.mode === "local") return { mode: "local", reason: readiness.reason };
      if (readiness.mode !== "cloud") throw new Error(readiness.reason);
      const event = core.createRewardEvent({ ...options, child_id: readiness.childId });
      const rpcBalance = await callRpc(event, options);
      let balance;
      try {
        balance = await getChildBalances(readiness.childId);
      } catch (refreshError) {
        balance = core.normalizeServerBalance(rpcBalance);
      }
      return { mode: "cloud", event, balance: core.normalizeServerBalance(balance) };
    } catch (error) {
      return { mode: "error", error, message: safeMessage(error) };
    }
  });
}

window.HapichikeOnlineRewards = Object.freeze({ mutate });
