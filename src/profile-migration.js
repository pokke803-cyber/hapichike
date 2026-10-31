(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./child-identity-core.js")
    : root.HapichikeChildIdentity;
  const domain = typeof module === "object" && module.exports
    ? require("./profile-domain.js")
    : root.HapichikeProfileDomain;
  const backup = typeof module === "object" && module.exports
    ? require("./backup-core.js")
    : root.HapichikeBackup;
  const api = factory(core, domain, backup);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeProfileMigration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, domain, backup) {
  "use strict";

  if (!core || !domain || !backup) throw new Error("Hapichike migration dependencies are required");

  const V1_KEY = "kidsVegasCasino.v1";
  const V2_KEY = core.STORAGE_KEY;
  const CLOUD_MAPPING_V1_KEY = "kidsVegasCasino.cloudMapping.v1";
  const SAFETY_KEY = "kidsVegasCasino.identityMigrationSafety.v1";
  const MIGRATION_VERSION = 1;
  const SOURCE_NAME = "legacy-single-profile";
  const KNOWN_FIELDS = new Set([
    "childName", "coins", "starCoins", "happyChanceCards", "points", "tasks", "todayTasks",
    "history", "payLogs", "transferHistory", "ticketGiftLogs", "taskHistory", "starGiftHistory",
    "badges", "lastDailyResetKey", "parentPassword", "parentEmail", "audioSettings",
  ]);
  const OPTIONAL_ARRAY_FIELDS = ["payLogs", "transferHistory", "ticketGiftLogs", "taskHistory", "starGiftHistory", "badges"];
  const SECRET_PATTERN = /(password|access.?token|refresh.?token|auth.?session|service.?role|staging.?credential|staging_parent)/i;
  const TASK_MASTER_FIELDS = ["id", "icon", "title", "difficulty", "ticketReward", "rewardType", "starCoinReward", "category", "isDefault"];

  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  function canonicalize(value) {
    core.assertSafeValue(value, "migration source");
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (core.isPlainObject(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  // Synchronous SHA-256 keeps preview/apply usable in static browsers and Node without a crypto fallback ID.
  function sha256(text) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const words = [];
    const ascii = unescape(encodeURIComponent(text));
    const bitLength = ascii.length * 8;
    for (let index = 0; index < ascii.length; index += 1) words[index >> 2] |= ascii.charCodeAt(index) << (24 - (index % 4) * 8);
    words[bitLength >> 5] |= 0x80 << (24 - bitLength % 32);
    words[((bitLength + 64 >> 9) << 4) + 15] = bitLength;
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const constants = [];
    let candidate = 2;
    while (constants.length < 64) {
      let prime = true;
      for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) if (candidate % divisor === 0) { prime = false; break; }
      if (prime) constants.push((Math.pow(candidate, 1 / 3) % 1) * 0x100000000 | 0);
      candidate += 1;
    }
    for (let offset = 0; offset < words.length; offset += 16) {
      const schedule = Array.from({ length: 64 }, (_, index) => words[offset + index] | 0);
      const working = hash.slice();
      for (let index = 16; index < 64; index += 1) {
        const w15 = schedule[index - 15] | 0;
        const w2 = schedule[index - 2] | 0;
        const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
      }
      for (let index = 0; index < 64; index += 1) {
        const e = working[4];
        const a = working[0];
        const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const choice = (e & working[5]) ^ (~e & working[6]);
        const temp1 = (working[7] + sum1 + choice + constants[index] + schedule[index]) | 0;
        const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const majority = (a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]);
        const temp2 = (sum0 + majority) | 0;
        working[7] = working[6]; working[6] = working[5]; working[5] = working[4];
        working[4] = (working[3] + temp1) | 0; working[3] = working[2]; working[2] = working[1];
        working[1] = working[0]; working[0] = (temp1 + temp2) | 0;
      }
      for (let index = 0; index < 8; index += 1) hash[index] = (hash[index] + working[index]) | 0;
    }
    return hash.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function parseSource(raw) {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("kidsVegasCasino.v1 was not found");
    let source;
    try { source = JSON.parse(raw); } catch { throw new Error("kidsVegasCasino.v1 contains invalid JSON"); }
    core.assertSafeValue(source, V1_KEY);
    if (!core.isPlainObject(source)) throw new Error("kidsVegasCasino.v1 must be an object");
    function assertNoForbiddenSecrets(value, path, allowParentPassword) {
      if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenSecrets(item, `${path}[${index}]`, false));
      if (!core.isPlainObject(value)) return;
      Object.keys(value).forEach(key => {
        if (SECRET_PATTERN.test(key) && !(allowParentPassword && key === "parentPassword")) {
          throw new Error(`${path}.${key} is a forbidden secret field`);
        }
        assertNoForbiddenSecrets(value[key], `${path}.${key}`, false);
      });
    }
    assertNoForbiddenSecrets(source, V1_KEY, true);
    if (typeof source.childName !== "string") throw new Error("childName must be a string");
    ["coins", "starCoins", "happyChanceCards"].forEach(key => {
      if (typeof source[key] !== "number" || !Number.isFinite(source[key])) throw new Error(`${key} must be a finite number`);
    });
    if (!core.isPlainObject(source.points)) throw new Error("points must be an object");
    ["snack", "toy", "game"].forEach(key => {
      if (typeof source.points[key] !== "number" || !Number.isFinite(source.points[key])) throw new Error(`points.${key} must be a finite number`);
    });
    ["tasks", "todayTasks", "history"].forEach(key => {
      if (!Array.isArray(source[key])) throw new Error(`${key} must be an array`);
    });
    OPTIONAL_ARRAY_FIELDS.forEach(key => {
      if (own(source, key) && !Array.isArray(source[key])) throw new Error(`${key} must be an array`);
    });
    [...source.tasks, ...source.todayTasks, ...source.history].forEach((item, index) => {
      if (!core.isPlainObject(item)) throw new Error(`migration array item ${index} must be an object`);
    });
    return source;
  }

  function requireTargetDisplayName(value) {
    if (typeof value !== "string" || !value.trim()) throw new Error("targetDisplayName must be explicitly selected");
    if ([...value.trim()].length > 12) throw new Error("targetDisplayName must be 12 characters or fewer");
    return value.trim();
  }

  function classifyUnknown(source, legacyFieldScopes = {}) {
    core.assertSafeValue(legacyFieldScopes, "legacyFieldScopes");
    const profile = {};
    const household = {};
    const undecided = [];
    Object.keys(source).filter(key => !KNOWN_FIELDS.has(key)).sort().forEach(key => {
      const scope = legacyFieldScopes[key];
      if (scope === "profile") profile[key] = core.clone(source[key]);
      else if (scope === "household") household[key] = core.clone(source[key]);
      else undecided.push(key);
    });
    Object.keys(legacyFieldScopes).forEach(key => {
      if (!own(source, key) || KNOWN_FIELDS.has(key)) throw new Error(`legacyFieldScopes.${key} does not reference an unknown source field`);
      if (!["profile", "household"].includes(legacyFieldScopes[key])) throw new Error(`legacyFieldScopes.${key} must be profile or household`);
    });
    return { profile, household, undecided };
  }

  function taskMasterFrom(source) {
    return source.tasks.map((task, index) => {
      if (!core.isPlainObject(task)) throw new Error(`tasks[${index}] must be an object`);
      if (typeof task.id !== "string" || !task.id) throw new Error(`tasks[${index}].id must be a string`);
      const result = {};
      TASK_MASTER_FIELDS.forEach(key => { if (own(task, key)) result[key] = core.clone(task[key]); });
      return result;
    });
  }

  function taskStatusExtras(source) {
    const statuses = source.tasks.filter(task => own(task, "status")).map(task => ({ taskId: task.id, status: core.clone(task.status) }));
    return statuses.length ? { taskStatuses: statuses } : {};
  }

  function deepEqual(left, right) { return canonicalize(left) === canonicalize(right); }

  function mergeNamedObjects(existing, incoming, path, conflicts) {
    const result = core.clone(existing);
    Object.keys(incoming).forEach(key => {
      if (!own(result, key)) result[key] = core.clone(incoming[key]);
      else if (!deepEqual(result[key], incoming[key])) conflicts.push(`${path}.${key}`);
    });
    return result;
  }

  function mergeTaskMaster(existing, incoming, conflicts) {
    const result = core.clone(existing);
    const byId = new Map(result.map((task, index) => [task.id, { task, index }]));
    incoming.forEach(task => {
      if (!byId.has(task.id)) result.push(core.clone(task));
      else if (!deepEqual(byId.get(task.id).task, task)) conflicts.push(`householdShared.taskMaster[id=${task.id}]`);
    });
    return result;
  }

  function buildHouseholdMerge(store, source, classified) {
    const current = { ...core.createDefaultHouseholdShared(), ...core.clone(store.householdShared) };
    const conflicts = [];
    const taskMaster = mergeTaskMaster(current.taskMaster, taskMasterFrom(source), conflicts);
    const incomingExtras = { ...taskStatusExtras(source), ...classified.household };
    const legacyExtras = mergeNamedObjects(current.legacyExtras, incomingExtras, "householdShared.legacyExtras", conflicts);
    const next = { ...current, taskMaster, legacyExtras };
    if (!deepEqual(current.dailyResetPolicy, { hour: 6 })) conflicts.push("householdShared.dailyResetPolicy");
    core.validateHouseholdShared(next);
    return { householdShared: next, conflicts };
  }

  function readExistingStore(storage, nowIso) {
    const raw = storage.getItem(V2_KEY);
    return raw === null ? core.createEmptyStore(nowIso) : core.clone(core.parseStore(raw));
  }

  function existingMigrationByHash(store, sourceHash) {
    const records = Array.isArray(store.identityMigrations) ? store.identityMigrations : [];
    return records.find(record => record && record.sourceHash === sourceHash);
  }

  function prepare(storage, options = {}) {
    if (!storage || typeof storage.getItem !== "function") throw new Error("a localStorage-compatible storage is required");
    const targetDisplayName = requireTargetDisplayName(options.targetDisplayName);
    const sourceRaw = storage.getItem(V1_KEY);
    const source = parseSource(sourceRaw);
    const sourceHash = sha256(canonicalize(source));
    const now = options.now || (() => new Date());
    const store = readExistingStore(storage, now().toISOString());
    const duplicate = existingMigrationByHash(store, sourceHash);
    const classified = classifyUnknown(source, options.legacyFieldScopes || {});
    const merge = buildHouseholdMerge(store, source, classified);
    const previewToken = sha256(canonicalize({ migrationVersion: MIGRATION_VERSION, sourceHash, targetDisplayName, legacyFieldScopes: options.legacyFieldScopes || {} }));
    const completed = source.todayTasks.filter(task => task.status === "done" || task.status === "completed" || task.status === "finished").length;
    const excludedSecretFields = own(source, "parentPassword") ? ["parentPassword"] : [];
    const preview = {
      migrationVersion: MIGRATION_VERSION,
      sourceHash,
      previewToken,
      sourceChildName: source.childName,
      targetDisplayName,
      balances: Object.fromEntries(Object.entries(domain.BALANCE_MAPPING).map(([name, mapping]) => {
        const parts = mapping.v1.split(".");
        return [name, parts.reduce((value, part) => value[part], source)];
      })),
      todayTasks: { count: source.todayTasks.length, completed, pending: source.todayTasks.length - completed },
      taskAssignments: source.todayTasks.length,
      completionState: source.todayTasks.map(task => ({ taskId: task.taskId, status: task.status, ticketGranted: Boolean(task.ticketGranted) })),
      historyCount: source.history.length + OPTIONAL_ARRAY_FIELDS.filter(key => key !== "badges").reduce((sum, key) => sum + (source[key]?.length || 0), 0),
      progress: { badgeCount: source.badges?.length || 0, badges: core.clone(source.badges || []) },
      resetState: { lastDailyResetKey: typeof source.lastDailyResetKey === "string" ? source.lastDailyResetKey : "", dailyResetHour: 6 },
      householdShared: { taskMasterCount: taskMasterFrom(source).length },
      legacyExtras: { profileCount: Object.keys(classified.profile).length, householdCount: Object.keys(classified.household).length + Object.keys(taskStatusExtras(source)).length, undecided: classified.undecided },
      excludedSecretFields,
      excludedDeviceLocalFields: own(source, "audioSettings") ? ["audioSettings"] : [],
      conflicts: merge.conflicts,
      duplicateMigration: duplicate ? { targetLocalChildKey: duplicate.targetLocalChildKey, migratedAt: duplicate.migratedAt } : null,
      canApply: !duplicate && classified.undecided.length === 0 && merge.conflicts.length === 0,
    };
    return { sourceRaw, source, sourceHash, targetDisplayName, store, classified, merge, preview };
  }

  function previewLegacyMigration(storage, options = {}) {
    return core.clone(prepare(storage, options).preview);
  }

  function buildProfile(source, localChildKey, targetDisplayName, classified, now, cryptoApi) {
    let profile = core.createProfileData({ localChildKey, childName: targetDisplayName }, { now, cryptoApi });
    const balances = Object.fromEntries(Object.entries(domain.BALANCE_MAPPING).map(([name, mapping]) => {
      const parts = mapping.v1.split(".");
      return [name, parts.reduce((value, part) => value[part], source)];
    }));
    profile = domain.setBalances(profile, balances);
    profile.todayTasks = core.clone(source.todayTasks);
    profile.history = core.clone(source.history);
    profile.payLogs = core.clone(source.payLogs || []);
    profile.transferHistory = core.clone(source.transferHistory || []);
    profile.ticketGiftLogs = core.clone(source.ticketGiftLogs || []);
    profile.taskHistory = core.clone(source.taskHistory || []);
    profile.starGiftHistory = core.clone(source.starGiftHistory || []);
    profile.badges = core.clone(source.badges || []);
    profile.lastDailyResetKey = typeof source.lastDailyResetKey === "string" ? source.lastDailyResetKey : "";
    profile.legacyExtras = core.clone(classified.profile);
    core.validateProfile(profile, localChildKey);
    return profile;
  }

  function restoreRaw(storage, key, raw) {
    if (raw === null) storage.removeItem(key);
    else storage.setItem(key, raw);
  }

  function applyLegacyMigration(storage, options = {}) {
    if (!storage || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new Error("a localStorage-compatible storage is required");
    }
    if (typeof options.previewToken !== "string" || !options.previewToken) throw new Error("previewToken is required");
    const prepared = prepare(storage, options);
    if (prepared.preview.previewToken !== options.previewToken) throw new Error("preview token or source state changed; create a new preview");
    if (prepared.preview.duplicateMigration) throw new Error("this legacy source has already been migrated");
    if (prepared.classified.undecided.length) throw new Error(`unknown legacy fields require an explicit scope: ${prepared.classified.undecided.join(", ")}`);
    if (prepared.merge.conflicts.length) throw new Error(`householdShared conflicts require parent resolution: ${prepared.merge.conflicts.join(", ")}`);

    const now = options.now || (() => new Date());
    const cryptoApi = options.cryptoApi || globalThis.crypto;
    const migratedAt = now().toISOString();
    const localChildKey = core.generateLocalChildKey(cryptoApi);
    if (own(prepared.store.profiles, localChildKey)) throw new Error("generated localChildKey already exists");
    const profile = buildProfile(prepared.source, localChildKey, prepared.targetDisplayName, prepared.classified, now, cryptoApi);
    const record = {
      migrationVersion: MIGRATION_VERSION,
      migratedAt,
      source: SOURCE_NAME,
      targetLocalChildKey: localChildKey,
      sourceHash: prepared.sourceHash,
    };
    const candidate = core.clone(prepared.store);
    candidate.profiles[localChildKey] = profile;
    candidate.householdShared = prepared.merge.householdShared;
    candidate.activeLocalChildKey = localChildKey;
    candidate.identityMigrations = [...(Array.isArray(candidate.identityMigrations) ? candidate.identityMigrations : []), record];
    candidate.updatedAt = migratedAt;
    core.validateStore(candidate);
    const candidateRaw = JSON.stringify(candidate);
    const safety = {
      format: "hapichike-identity-migration-safety",
      migrationVersion: MIGRATION_VERSION,
      createdAt: migratedAt,
      sourceKey: V1_KEY,
      sourceHash: prepared.sourceHash,
      source: backup.stripSecrets(prepared.source),
      excludedSecretFields: prepared.preview.excludedSecretFields,
    };
    core.assertSafeValue(safety, "migration safety");
    const safetyRaw = JSON.stringify(safety);
    const previousV2Raw = storage.getItem(V2_KEY);
    const originalV1Raw = prepared.sourceRaw;
    const originalMappingRaw = storage.getItem(CLOUD_MAPPING_V1_KEY);

    storage.setItem(SAFETY_KEY, safetyRaw);
    if (storage.getItem(SAFETY_KEY) !== safetyRaw) throw new Error("migration safety copy readback failed");
    try {
      storage.setItem(V2_KEY, candidateRaw);
      const readbackRaw = storage.getItem(V2_KEY);
      if (readbackRaw !== candidateRaw) throw new Error("v2 readback did not match the migration write");
      const readback = core.parseStore(readbackRaw);
      if (!existingMigrationByHash(readback, prepared.sourceHash)) throw new Error("migration completion metadata was not persisted");
      if (storage.getItem(V1_KEY) !== originalV1Raw) throw new Error("legacy v1 changed during migration");
      if (storage.getItem(CLOUD_MAPPING_V1_KEY) !== originalMappingRaw) throw new Error("cloudMapping v1 changed during migration");
      return { localChildKey, sourceHash: prepared.sourceHash, migrationVersion: MIGRATION_VERSION, safetyKey: SAFETY_KEY, profile: core.clone(profile), preview: core.clone(prepared.preview) };
    } catch (error) {
      try { restoreRaw(storage, V2_KEY, previousV2Raw); }
      catch { throw new Error(`migration and v2 rollback failed: ${error.message}`); }
      throw new Error(`migration failed; previous v2 was restored: ${error.message}`);
    }
  }

  return Object.freeze({
    V1_KEY, V2_KEY, CLOUD_MAPPING_V1_KEY, SAFETY_KEY, MIGRATION_VERSION, SOURCE_NAME,
    canonicalize, sha256, previewLegacyMigration, applyLegacyMigration,
  });
});
