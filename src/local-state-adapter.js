(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports && typeof require === "function";
  const core = commonJs
    ? require("./child-identity-core.js")
    : root.HapichikeChildIdentity;
  const mapping = commonJs
    ? require("./cloud-mapping-core.js")
    : root.HapichikeCloudMapping;
  const api = factory(core, mapping);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeLocalState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, mapping) {
  "use strict";

  if (!core) throw new Error("HapichikeChildIdentity is required");

  const V1_KEY = "kidsVegasCasino.v1";
  const V2_KEY = core.STORAGE_KEY;
  const ACTIVATION_KEY = "kidsVegasCasino.v2.activation";
  const DEVICE_SETTINGS_KEY = "kidsVegasCasino.deviceSettings.v1";
  const PROFILE_FIELDS = Object.freeze([
    "childName", "coins", "starCoins", "happyChanceCards", "points", "todayTasks",
    "history", "payLogs", "transferHistory", "ticketGiftLogs", "taskHistory",
    "starGiftHistory", "badges", "lastDailyResetKey",
  ]);

  function clone(value) { return core.clone(value); }

  function isActivatedStore(store) {
    return store?.activation?.status === "active"
      || (Array.isArray(store?.identityMigrations) && store.identityMigrations.length > 0);
  }

  function hasActivationMarker(storage) {
    return storage.getItem(ACTIVATION_KEY) === "active";
  }

  function readV2(storage) {
    return core.parseStore(storage.getItem(V2_KEY));
  }

  function requireActiveProfile(store) {
    core.validateStore(store);
    if (!store.activeLocalChildKey) throw new Error("V2_ACTIVE_CHILD_MISSING");
    const profile = store.profiles[store.activeLocalChildKey];
    if (!profile) throw new Error("V2_ACTIVE_PROFILE_MISSING");
    core.validateProfile(profile, store.activeLocalChildKey);
    return profile;
  }

  function readLegacy(storage, fallbackFactory) {
    try {
      const parsed = JSON.parse(storage.getItem(V1_KEY));
      if (core.isPlainObject(parsed) && Array.isArray(parsed.tasks)) return parsed;
    } catch {}
    return typeof fallbackFactory === "function" ? fallbackFactory() : null;
  }

  function readDeviceSettings(storage, legacy) {
    try {
      const parsed = JSON.parse(storage.getItem(DEVICE_SETTINGS_KEY));
      if (core.isPlainObject(parsed)) return parsed;
    } catch {}
    return {
      audioSettings: clone(legacy?.audioSettings || {
        bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.22, sfxVolume: 0.62,
      }),
    };
  }

  function composeRuntimeState(store, profile, legacy, device) {
    return {
      ...clone(profile),
      tasks: clone(store.householdShared.taskMaster || []),
      parentPassword: typeof legacy?.parentPassword === "string" ? legacy.parentPassword : "1234",
      parentEmail: typeof legacy?.parentEmail === "string" ? legacy.parentEmail : "",
      audioSettings: clone(device.audioSettings || legacy?.audioSettings || {}),
    };
  }

  function load(storage, fallbackFactory) {
    const markerActive = hasActivationMarker(storage);
    const legacyMissing = storage.getItem(V1_KEY) === null;
    let store;
    try { store = readV2(storage); }
    catch (error) {
      if (markerActive) throw new Error(`V2_FAIL_CLOSED: ${error.message}`);
      return { mode: legacyMissing ? "empty" : "legacy", state: readLegacy(storage, fallbackFactory), store: null };
    }
    if (!markerActive) return { mode: legacyMissing ? "empty" : "legacy", state: readLegacy(storage, fallbackFactory), store };
    if (!store) throw new Error("V2_FAIL_CLOSED: activated store is missing");
    const profile = requireActiveProfile(store);
    const legacy = readLegacy(storage, () => ({})) || {};
    const device = readDeviceSettings(storage, legacy);
    return { mode: "v2", state: composeRuntimeState(store, profile, legacy, device), store: clone(store) };
  }

  function writeRawWithRollback(storage, key, raw) {
    const previous = storage.getItem(key);
    try {
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error("readback mismatch");
    } catch (error) {
      try {
        if (previous === null) storage.removeItem(key); else storage.setItem(key, previous);
      } catch { throw new Error(`write and rollback failed: ${error.message}`); }
      throw new Error(`write failed; previous data was restored: ${error.message}`);
    }
  }

  function writeTransaction(storage, entries) {
    const previous = new Map(entries.map(([key]) => [key, storage.getItem(key)]));
    try {
      entries.forEach(([key, raw]) => {
        storage.setItem(key, raw);
        if (storage.getItem(key) !== raw) throw new Error(`${key} readback mismatch`);
      });
    } catch (error) {
      try {
        [...previous.entries()].forEach(([key, raw]) => {
          if (raw === null) storage.removeItem(key); else storage.setItem(key, raw);
        });
      } catch { throw new Error(`transaction and rollback failed: ${error.message}`); }
      throw new Error(`transaction failed; previous data was restored: ${error.message}`);
    }
  }

  function saveActive(storage, runtimeState, now = new Date().toISOString()) {
    if (!hasActivationMarker(storage)) throw new Error("V2_NOT_ACTIVATED");
    const store = readV2(storage);
    const current = requireActiveProfile(store);
    const next = clone(store);
    const profile = clone(current);
    PROFILE_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(runtimeState, field)) profile[field] = clone(runtimeState[field]);
    });
    profile.tasks = [];
    profile.updatedAt = now;
    core.validateProfile(profile, profile.localChildKey);
    next.profiles[profile.localChildKey] = profile;
    next.householdShared.taskMaster = clone(runtimeState.tasks || []);
    next.updatedAt = now;
    core.validateStore(next);
    const device = { audioSettings: clone(runtimeState.audioSettings || {}) };
    writeTransaction(storage, [
      [V2_KEY, JSON.stringify(next)],
      [DEVICE_SETTINGS_KEY, JSON.stringify(device)],
      [ACTIVATION_KEY, "active"],
    ]);
    return composeRuntimeState(next, profile, runtimeState, device);
  }

  function save(storage, runtimeState, now) {
    const loaded = load(storage, () => runtimeState);
    if (loaded.mode === "empty") throw new Error("EMPTY_LEGACY_READ_ONLY");
    if (loaded.mode === "legacy") {
      storage.setItem(V1_KEY, JSON.stringify(runtimeState));
      return { mode: "legacy", state: runtimeState };
    }
    return { mode: "v2", state: saveActive(storage, runtimeState, now) };
  }

  function activate(storage, localChildKey, activatedAt = new Date().toISOString()) {
    const store = readV2(storage);
    if (!store) throw new Error("V2_STORE_MISSING");
    core.validateLocalChildKey(localChildKey);
    if (!store.profiles[localChildKey]) throw new Error("V2_ACTIVE_PROFILE_MISSING");
    const next = clone(store);
    next.activeLocalChildKey = localChildKey;
    next.activation = { status: "active", activatedAt };
    next.updatedAt = activatedAt;
    core.validateStore(next);
    writeTransaction(storage, [[V2_KEY, JSON.stringify(next)], [ACTIVATION_KEY, "active"]]);
    return clone(next);
  }

  function listProfiles(storage) {
    const store = readV2(storage);
    if (!store || !hasActivationMarker(storage)) return [];
    requireActiveProfile(store);
    return Object.values(store.profiles).map(profile => ({
      localChildKey: profile.localChildKey,
      childName: profile.childName || "名前未設定",
      active: profile.localChildKey === store.activeLocalChildKey,
    }));
  }

  function switchActive(storage, localChildKey, now = new Date().toISOString()) {
    const store = readV2(storage);
    if (!store || !hasActivationMarker(storage)) throw new Error("V2_NOT_ACTIVATED");
    core.validateLocalChildKey(localChildKey);
    if (!store.profiles[localChildKey]) throw new Error("V2_ACTIVE_PROFILE_MISSING");
    const next = clone(store);
    next.activeLocalChildKey = localChildKey;
    next.updatedAt = now;
    core.validateStore(next);
    writeRawWithRollback(storage, V2_KEY, JSON.stringify(next));
    return clone(next.profiles[localChildKey]);
  }

  function resolveRewardChild(storage, context = {}) {
    const loaded = load(storage, () => null);
    if (loaded.mode !== "v2") return { mode: "legacy-local", cloudReady: false, localChildKey: "legacy-single-profile" };
    const localChildKey = loaded.store.activeLocalChildKey;
    let document;
    try { document = mapping.parseV2MappingDocument(storage.getItem(mapping.MAPPING_V2_STORAGE_KEY)); }
    catch { return { mode: "blocked", cloudReady: false, reason: "MAPPING_INVALID", localChildKey }; }
    const localMatches = document.mappings.filter(item => item.localChildKey === localChildKey);
    if (localMatches.length !== 1) return { mode: "blocked", cloudReady: false, reason: localMatches.length ? "MAPPING_DUPLICATE" : "MAPPING_MISSING", localChildKey };
    const selected = localMatches[0];
    if (document.mappings.filter(item => item.supabaseChildId === selected.supabaseChildId).length !== 1) {
      return { mode: "blocked", cloudReady: false, reason: "CLOUD_CHILD_DUPLICATE", localChildKey };
    }
    if (context.householdId && selected.householdId !== context.householdId) {
      return { mode: "blocked", cloudReady: false, reason: "HOUSEHOLD_MISMATCH", localChildKey };
    }
    if (Array.isArray(context.visibleChildren)
      && !context.visibleChildren.some(child => child.id === selected.supabaseChildId && (!context.householdId || child.householdId === context.householdId))) {
      return { mode: "blocked", cloudReady: false, reason: "MAPPING_STALE", localChildKey };
    }
    return { mode: "cloud", cloudReady: true, localChildKey, supabaseChildId: selected.supabaseChildId, householdId: selected.householdId };
  }

  return Object.freeze({
    V1_KEY, V2_KEY, ACTIVATION_KEY, DEVICE_SETTINGS_KEY, PROFILE_FIELDS,
    isActivatedStore, hasActivationMarker, load, save, saveActive, activate,
    listProfiles, switchActive, resolveRewardChild,
  });
});
