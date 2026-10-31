(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./child-identity-core.js")
    : root.HapichikeChildIdentity;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeProfileDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("HapichikeChildIdentity is required");

  const BALANCE_MAPPING = Object.freeze({
    tickets: Object.freeze({ v1: "coins", profile: "balances.tickets", cloud: "tickets" }),
    starCoins: Object.freeze({ v1: "starCoins", profile: "balances.starCoins", cloud: "star_coins" }),
    sweetsPay: Object.freeze({ v1: "points.snack", profile: "balances.sweetsPay", cloud: "sweets_pay" }),
    toyPay: Object.freeze({ v1: "points.toy", profile: "balances.toyPay", cloud: "toy_pay" }),
    gamePay: Object.freeze({ v1: "points.game", profile: "balances.gamePay", cloud: "game_pay" }),
    happyChanceCards: Object.freeze({ v1: "happyChanceCards", profile: "balances.happyChanceCards", cloud: "happy_chance_cards" }),
  });

  const HISTORY_FIELDS = Object.freeze({
    rewardLog: "history",
    payUsage: "payLogs",
    payTransfers: "transferHistory",
    ticketGifts: "ticketGiftLogs",
    completedTasks: "taskHistory",
    thankYouStarMessages: "starGiftHistory",
  });

  function requireProfile(profile) {
    if (!core.isPlainObject(profile) || typeof profile.localChildKey !== "string") {
      throw new Error("profile must be a profile object");
    }
    return profile;
  }

  function requireFiniteNumber(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  }

  function requireObjectArray(value, path) {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    value.forEach((item, index) => {
      if (!core.isPlainObject(item)) throw new Error(`${path}[${index}] must be an object`);
      core.assertSafeValue(item, `${path}[${index}]`);
    });
    return core.clone(value);
  }

  function requireStringArray(value, path) {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
    return core.clone(value);
  }

  function getBalances(profile) {
    requireProfile(profile);
    const balances = {
      tickets: profile.coins,
      starCoins: profile.starCoins,
      sweetsPay: profile.points?.snack,
      toyPay: profile.points?.toy,
      gamePay: profile.points?.game,
      happyChanceCards: profile.happyChanceCards,
    };
    Object.entries(balances).forEach(([key, value]) => requireFiniteNumber(value, `balances.${key}`));
    return balances;
  }

  function setBalances(profile, balances) {
    requireProfile(profile);
    core.assertSafeValue(balances, "balances");
    if (!core.isPlainObject(balances)) throw new Error("balances must be an object");
    const nextBalances = { ...getBalances(profile), ...core.clone(balances) };
    Object.entries(nextBalances).forEach(([key, value]) => requireFiniteNumber(value, `balances.${key}`));
    return {
      ...core.clone(profile),
      coins: nextBalances.tickets,
      starCoins: nextBalances.starCoins,
      happyChanceCards: nextBalances.happyChanceCards,
      points: {
        snack: nextBalances.sweetsPay,
        toy: nextBalances.toyPay,
        game: nextBalances.gamePay,
      },
    };
  }

  function getChildTasks(profile) {
    requireProfile(profile);
    return {
      assignments: requireObjectArray(profile.todayTasks, "profile.todayTasks"),
    };
  }

  function updateChildTasks(profile, patch) {
    requireProfile(profile);
    core.assertSafeValue(patch, "child tasks patch");
    if (!core.isPlainObject(patch)) throw new Error("child tasks patch must be an object");
    const next = core.clone(profile);
    if (Object.prototype.hasOwnProperty.call(patch, "assignments")) {
      next.todayTasks = requireObjectArray(patch.assignments, "child tasks assignments");
    }
    return next;
  }

  function getChildHistory(profile) {
    requireProfile(profile);
    return Object.fromEntries(Object.entries(HISTORY_FIELDS).map(([name, field]) => [
      name,
      field === "starGiftHistory" ? core.clone(profile[field]) : requireObjectArray(profile[field], `profile.${field}`),
    ]));
  }

  function appendChildHistory(profile, channel, entry, limit) {
    requireProfile(profile);
    const field = HISTORY_FIELDS[channel];
    if (!field) throw new Error("unknown child history channel");
    const next = core.clone(profile);
    if (field === "starGiftHistory") {
      if (typeof entry !== "string") throw new Error("thank-you star history entry must be a string");
    } else if (!core.isPlainObject(entry)) {
      throw new Error("child history entry must be an object");
    }
    core.assertSafeValue(entry, "child history entry");
    const maximum = limit === undefined ? Infinity : limit;
    if (!(maximum === Infinity || (Number.isInteger(maximum) && maximum >= 0))) throw new Error("history limit must be a non-negative integer");
    next[field] = [core.clone(entry), ...next[field]].slice(0, maximum);
    return next;
  }

  function getProgress(profile) {
    requireProfile(profile);
    return { badges: requireStringArray(profile.badges, "profile.badges") };
  }

  function updateProgress(profile, patch) {
    requireProfile(profile);
    core.assertSafeValue(patch, "progress patch");
    if (!core.isPlainObject(patch)) throw new Error("progress patch must be an object");
    const next = core.clone(profile);
    if (Object.prototype.hasOwnProperty.call(patch, "badges")) next.badges = requireStringArray(patch.badges, "progress.badges");
    return next;
  }

  function getResetState(profile) {
    requireProfile(profile);
    if (typeof profile.lastDailyResetKey !== "string") throw new Error("profile.lastDailyResetKey must be a string");
    return { lastDailyResetKey: profile.lastDailyResetKey };
  }

  function updateResetState(profile, patch) {
    requireProfile(profile);
    core.assertSafeValue(patch, "reset state patch");
    if (!core.isPlainObject(patch)) throw new Error("reset state patch must be an object");
    const next = core.clone(profile);
    if (Object.prototype.hasOwnProperty.call(patch, "lastDailyResetKey")) {
      if (typeof patch.lastDailyResetKey !== "string") throw new Error("resetState.lastDailyResetKey must be a string");
      next.lastDailyResetKey = patch.lastDailyResetKey;
    }
    return next;
  }

  function getHouseholdShared(rootStore) {
    if (!core.isPlainObject(rootStore)) throw new Error("profile store must be an object");
    core.validateHouseholdShared(rootStore.householdShared);
    return { ...core.createDefaultHouseholdShared(), ...core.clone(rootStore.householdShared) };
  }

  function updateHouseholdShared(rootStore, patch) {
    const current = getHouseholdShared(rootStore);
    core.assertSafeValue(patch, "household shared patch");
    if (!core.isPlainObject(patch)) throw new Error("household shared patch must be an object");
    const nextShared = { ...current, ...core.clone(patch) };
    ["rouletteSettings", "parentSettings", "dailyResetPolicy", "legacyExtras"].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) nextShared[key] = { ...current[key], ...core.clone(patch[key]) };
    });
    core.validateHouseholdShared(nextShared);
    return { ...core.clone(rootStore), householdShared: nextShared };
  }

  return Object.freeze({
    BALANCE_MAPPING,
    HISTORY_FIELDS,
    getBalances,
    setBalances,
    getChildTasks,
    updateChildTasks,
    getChildHistory,
    appendChildHistory,
    getProgress,
    updateProgress,
    getResetState,
    updateResetState,
    getHouseholdShared,
    updateHouseholdShared,
  });
});
