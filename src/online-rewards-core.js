(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeOnlineRewardsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APP_ID = "hapichike";
  const PAY_CATEGORIES = new Set(["sweets", "toy", "game"]);
  const locks = new Set();

  function createRewardEvent(input = {}, now = () => new Date()) {
    if (typeof input.type !== "string" || !input.type) throw new Error("reward event type is required");
    if (typeof input.child_id !== "string" || !input.child_id) throw new Error("reward event child_id is required");
    if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error("reward event amount must be a non-zero integer");
    if (input.type === "pay" && !PAY_CATEGORIES.has(input.category)) throw new Error("invalid PAY category");
    return {
      type: input.type,
      child_id: input.child_id,
      amount: input.amount,
      category: input.category ?? null,
      source: typeof input.source === "string" && input.source ? input.source : "hapichike_ui",
      created_at: now().toISOString(),
    };
  }

  function evaluateCloudReady(input = {}) {
    if (!input.mapping) return { mode: "local", reason: "mapping_missing" };
    if (!input.session?.user) return { mode: "blocked", reason: "session_missing" };
    if (!input.networkAvailable) return { mode: "blocked", reason: "offline" };
    if (!input.householdValid) return { mode: "blocked", reason: "household_invalid" };
    if (!input.childVisible) return { mode: "blocked", reason: "mapping_invalid" };
    if (!input.syncStateLoaded) return { mode: "blocked", reason: "sync_state_unavailable" };
    if (!input.syncState || input.syncState.app_id !== APP_ID || !input.syncState.initial_import_completed_at) {
      return { mode: "local", reason: "initial_import_incomplete" };
    }
    return { mode: "cloud", reason: "ready", childId: input.mapping.supabaseChildId };
  }

  function normalizeServerBalance(value) {
    const balance = Array.isArray(value) ? value[0] : value;
    const keys = ["tickets", "star_coins", "sweets_pay", "toy_pay", "game_pay", "happy_chance_cards"];
    if (!balance || keys.some(key => !Number.isFinite(Number(balance[key])))) {
      throw new Error("server balance is unavailable");
    }
    return Object.fromEntries(keys.map(key => [key, Number(balance[key])]));
  }

  function applyServerBalance(state, value) {
    const balance = normalizeServerBalance(value);
    state.coins = balance.tickets;
    state.starCoins = balance.star_coins;
    state.points.snack = balance.sweets_pay;
    state.points.toy = balance.toy_pay;
    state.points.game = balance.game_pay;
    state.happyChanceCards = balance.happy_chance_cards;
    return state;
  }

  async function withActionLock(key, action) {
    if (locks.has(key)) return { duplicate: true };
    locks.add(key);
    try {
      return await action();
    } finally {
      locks.delete(key);
    }
  }

  return {
    APP_ID,
    createRewardEvent,
    evaluateCloudReady,
    normalizeServerBalance,
    applyServerBalance,
    withActionLock,
  };
});
