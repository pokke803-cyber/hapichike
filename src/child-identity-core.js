(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeChildIdentity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APP_ID = "hapichike";
  const STORE_VERSION = 2;
  const STORAGE_KEY = "kidsVegasCasino.v2";
  const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const SECRET_KEYS = new Set([
    "parentpassword",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "supabaseauthtoken",
    "servicerole",
    "servicerolekey",
    "stagingcredentials",
  ]);
  const PROFILE_ARRAY_FIELDS = [
    "tasks",
    "todayTasks",
    "history",
    "payLogs",
    "transferHistory",
    "ticketGiftLogs",
    "taskHistory",
    "starGiftHistory",
    "badges",
  ];
  const HOUSEHOLD_ARRAY_FIELDS = ["taskMaster", "categoryMaster"];

  function createDefaultHouseholdShared() {
    return {
      taskMaster: [],
      categoryMaster: [],
      rouletteSettings: {},
      parentSettings: {},
      dailyResetPolicy: { hour: 6 },
      legacyExtras: {},
    };
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertSafeValue(value, path = "store") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(value)) throw new Error(`${path} must be a plain object`);
    Object.keys(value).forEach(key => {
      if (DANGEROUS_KEYS.has(key)) throw new Error(`${path} contains a dangerous key`);
      assertSafeValue(value[key], `${path}.${key}`);
    });
  }

  function clone(value) {
    assertSafeValue(value);
    return JSON.parse(JSON.stringify(value));
  }

  function assertNoSecretKeys(value, path = "store") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(value)) return;
    Object.keys(value).forEach(key => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (SECRET_KEYS.has(normalizedKey)) throw new Error(`${path} contains a forbidden secret field`);
      assertNoSecretKeys(value[key], `${path}.${key}`);
    });
  }

  function requireIsoTimestamp(value, path) {
    if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${path} must be an ISO-8601 timestamp`);
    }
  }

  function requireFiniteNumber(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${path} must be a finite number`);
    }
  }

  function validateLocalChildKey(value, path = "localChildKey") {
    if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
      throw new Error(`${path} must be a lowercase UUID v4`);
    }
    return value;
  }

  function generateLocalChildKey(cryptoApi = globalThis.crypto) {
    if (!cryptoApi || typeof cryptoApi.randomUUID !== "function") {
      throw new Error("crypto.randomUUID is required to create a local child profile");
    }
    return validateLocalChildKey(cryptoApi.randomUUID());
  }

  function validateProfile(profile, objectKey) {
    assertSafeValue(profile, `profiles.${objectKey}`);
    assertNoSecretKeys(profile, `profiles.${objectKey}`);
    if (!isPlainObject(profile)) throw new Error(`profiles.${objectKey} must be an object`);
    validateLocalChildKey(objectKey, "profile key");
    validateLocalChildKey(profile.localChildKey, `profiles.${objectKey}.localChildKey`);
    if (profile.localChildKey !== objectKey) throw new Error("profile key and localChildKey must match");
    if (typeof profile.childName !== "string") throw new Error(`profiles.${objectKey}.childName must be a string`);
    requireIsoTimestamp(profile.createdAt, `profiles.${objectKey}.createdAt`);
    requireIsoTimestamp(profile.updatedAt, `profiles.${objectKey}.updatedAt`);
    requireFiniteNumber(profile.coins, `profiles.${objectKey}.coins`);
    requireFiniteNumber(profile.starCoins, `profiles.${objectKey}.starCoins`);
    requireFiniteNumber(profile.happyChanceCards, `profiles.${objectKey}.happyChanceCards`);
    if (!isPlainObject(profile.points)) throw new Error(`profiles.${objectKey}.points must be an object`);
    ["snack", "toy", "game"].forEach(key => requireFiniteNumber(profile.points[key], `profiles.${objectKey}.points.${key}`));
    PROFILE_ARRAY_FIELDS.forEach(key => {
      if (!Array.isArray(profile[key])) throw new Error(`profiles.${objectKey}.${key} must be an array`);
      profile[key].forEach((item, index) => {
        if ((key === "starGiftHistory" || key === "badges") && typeof item === "string") return;
        if (!isPlainObject(item)) throw new Error(`profiles.${objectKey}.${key}[${index}] must be an object`);
      });
    });
    if (typeof profile.lastDailyResetKey !== "string") {
      throw new Error(`profiles.${objectKey}.lastDailyResetKey must be a string`);
    }
    if (Object.prototype.hasOwnProperty.call(profile, "legacyExtras") && !isPlainObject(profile.legacyExtras)) {
      throw new Error(`profiles.${objectKey}.legacyExtras must be an object`);
    }
    return profile;
  }

  function validateIdentityMigrations(records) {
    if (records === undefined) return;
    if (!Array.isArray(records)) throw new Error("identityMigrations must be an array");
    const hashes = new Set();
    records.forEach((record, index) => {
      const path = `identityMigrations[${index}]`;
      if (!isPlainObject(record)) throw new Error(`${path} must be an object`);
      if (record.migrationVersion !== 1) throw new Error(`${path}.migrationVersion must be 1`);
      requireIsoTimestamp(record.migratedAt, `${path}.migratedAt`);
      if (record.source !== "legacy-single-profile") throw new Error(`${path}.source is invalid`);
      validateLocalChildKey(record.targetLocalChildKey, `${path}.targetLocalChildKey`);
      if (typeof record.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(record.sourceHash)) {
        throw new Error(`${path}.sourceHash must be a SHA-256 hex digest`);
      }
      if (hashes.has(record.sourceHash)) throw new Error("identityMigrations contains a duplicate sourceHash");
      hashes.add(record.sourceHash);
    });
  }

  function validateHouseholdShared(householdShared) {
    assertSafeValue(householdShared, "householdShared");
    assertNoSecretKeys(householdShared, "householdShared");
    if (!isPlainObject(householdShared)) throw new Error("householdShared must be an object");
    HOUSEHOLD_ARRAY_FIELDS.forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(householdShared, key)) return;
      if (!Array.isArray(householdShared[key])) throw new Error(`householdShared.${key} must be an array`);
      householdShared[key].forEach((item, index) => {
        if (!isPlainObject(item)) throw new Error(`householdShared.${key}[${index}] must be an object`);
      });
    });
    ["rouletteSettings", "parentSettings", "dailyResetPolicy", "legacyExtras"].forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(householdShared, key)) return;
      if (!isPlainObject(householdShared[key])) throw new Error(`householdShared.${key} must be an object`);
    });
    if (Object.prototype.hasOwnProperty.call(householdShared, "dailyResetPolicy")) {
      const resetHour = householdShared.dailyResetPolicy.hour;
      if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
        throw new Error("householdShared.dailyResetPolicy.hour must be an integer from 0 to 23");
      }
    }
    return householdShared;
  }

  function validateStore(store) {
    assertSafeValue(store);
    if (!isPlainObject(store)) throw new Error("profile store must be an object");
    if (store.version !== STORE_VERSION) throw new Error(`profile store version must be ${STORE_VERSION}`);
    if (store.appId !== APP_ID) throw new Error(`profile store appId must be ${APP_ID}`);
    if (!isPlainObject(store.profiles)) throw new Error("profiles must be an object");
    validateHouseholdShared(store.householdShared);
    requireIsoTimestamp(store.updatedAt, "updatedAt");

    Object.keys(store.profiles).forEach(key => validateProfile(store.profiles[key], key));
    validateIdentityMigrations(store.identityMigrations);
    if (Array.isArray(store.identityMigrations)) {
      store.identityMigrations.forEach(record => {
        if (!Object.prototype.hasOwnProperty.call(store.profiles, record.targetLocalChildKey)) {
          throw new Error("identity migration must reference an existing profile");
        }
      });
    }
    if (store.activeLocalChildKey !== null) {
      validateLocalChildKey(store.activeLocalChildKey, "activeLocalChildKey");
      if (!Object.prototype.hasOwnProperty.call(store.profiles, store.activeLocalChildKey)) {
        throw new Error("activeLocalChildKey must reference an existing profile");
      }
    }
    return store;
  }

  function createEmptyStore(updatedAt = new Date().toISOString()) {
    const store = {
      version: STORE_VERSION,
      appId: APP_ID,
      activeLocalChildKey: null,
      profiles: {},
      householdShared: createDefaultHouseholdShared(),
      updatedAt,
    };
    return validateStore(store);
  }

  function createProfileData(input = {}, dependencies = {}) {
    const now = dependencies.now || (() => new Date());
    const timestamp = now().toISOString();
    const localChildKey = input.localChildKey || generateLocalChildKey(dependencies.cryptoApi);
    validateLocalChildKey(localChildKey);
    const profile = {
      localChildKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      childName: typeof input.childName === "string" ? input.childName : "",
      coins: 0,
      starCoins: 0,
      happyChanceCards: 0,
      points: { snack: 0, toy: 0, game: 0 },
      tasks: [],
      todayTasks: [],
      history: [],
      payLogs: [],
      transferHistory: [],
      ticketGiftLogs: [],
      taskHistory: [],
      starGiftHistory: [],
      badges: [],
      lastDailyResetKey: "",
    };
    return validateProfile(profile, localChildKey);
  }

  function parseStore(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    let store;
    try {
      store = JSON.parse(raw);
    } catch {
      throw new Error("kidsVegasCasino.v2 contains invalid JSON");
    }
    return validateStore(store);
  }

  return {
    APP_ID,
    STORE_VERSION,
    STORAGE_KEY,
    UUID_V4_PATTERN,
    PROFILE_ARRAY_FIELDS,
    HOUSEHOLD_ARRAY_FIELDS,
    isPlainObject,
    assertSafeValue,
    assertNoSecretKeys,
    clone,
    validateLocalChildKey,
    generateLocalChildKey,
    validateProfile,
    validateIdentityMigrations,
    validateHouseholdShared,
    validateStore,
    createEmptyStore,
    createDefaultHouseholdShared,
    createProfileData,
    parseStore,
  };
});
