(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeBackup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT = "hapichike-backup";
  const LEGACY_VERSION = 1;
  const VERSION = 2;
  const APP = "hapichike";
  const STORAGE_KEY = "kidsVegasCasino.v1";
  const V2_STORAGE_KEY = "kidsVegasCasino.v2";
  const EMAIL_KEY = "kidsVegasCasino.parentEmail.v1";
  const SAFETY_KEY = "kidsVegasCasino.restoreSafety.v1";
  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const SECRET_KEY_PATTERN = /(password|access.?token|refresh.?token|auth.?session|service.?role|staging_parent)/i;
  const ARRAY_FIELDS = ["tasks", "todayTasks", "history", "payLogs", "transferHistory", "ticketGiftLogs", "taskHistory", "starGiftHistory", "badges"];

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertSafeJson(value, path = "backup") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${path} に不正な数値があります。`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(value)) throw new Error(`${path} の型が不正です。`);
    Object.keys(value).forEach(key => {
      if (DANGEROUS_KEYS.has(key)) throw new Error(`${path} に危険なキーがあります。`);
      assertSafeJson(value[key], `${path}.${key}`);
    });
  }

  function stripSecrets(value) {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (!isPlainObject(value)) return value;
    const clean = {};
    Object.keys(value).forEach(key => {
      if (DANGEROUS_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) return;
      clean[key] = stripSecrets(value[key]);
    });
    return clean;
  }

  function parseMainState(raw) {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("端末の主データが見つかりません。");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("端末の主データが壊れているため、バックアップできません。");
    }
    assertSafeJson(parsed, STORAGE_KEY);
    return parsed;
  }

  function parseV2Store(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("端末のv2プロフィールが壊れているため、バックアップできません。"); }
    assertSafeJson(parsed, V2_STORAGE_KEY);
    if (!isPlainObject(parsed) || parsed.appId !== APP || parsed.version !== 2 || !isPlainObject(parsed.profiles)) {
      throw new Error("端末のv2プロフィール形式が正しくありません。");
    }
    if (parsed.activeLocalChildKey !== null && typeof parsed.activeLocalChildKey !== "string") {
      throw new Error("activeLocalChildKeyの型が不正です。");
    }
    if (!isPlainObject(parsed.householdShared)) throw new Error("householdSharedの型が不正です。");
    if (parsed.activeLocalChildKey !== null && !Object.prototype.hasOwnProperty.call(parsed.profiles, parsed.activeLocalChildKey)) {
      throw new Error("activeLocalChildKeyに対応するprofileがありません。");
    }
    return parsed;
  }

  function makeEnvelope(mainState, parentEmail, createdAt = new Date().toISOString(), v2Store = null) {
    const hasV2 = v2Store !== null;
    const envelope = {
      format: FORMAT,
      version: hasV2 ? VERSION : LEGACY_VERSION,
      createdAt,
      app: APP,
      data: {
        [STORAGE_KEY]: stripSecrets(mainState),
        [EMAIL_KEY]: typeof parentEmail === "string" ? parentEmail : "",
        ...(hasV2 ? { [V2_STORAGE_KEY]: stripSecrets(v2Store) } : {}),
      }
    };
    validateEnvelope(envelope);
    return envelope;
  }

  function createBackup(storage, createdAt = new Date().toISOString()) {
    const mainState = parseMainState(storage.getItem(STORAGE_KEY));
    const v2Store = parseV2Store(storage.getItem(V2_STORAGE_KEY));
    return makeEnvelope(mainState, storage.getItem(EMAIL_KEY) || "", createdAt, v2Store);
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("JSONとして読み込めないファイルです。");
    }
    return validateEnvelope(parsed);
  }

  function requireFiniteNumber(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} は有限の数値である必要があります。`);
  }

  function validateEnvelope(envelope) {
    assertSafeJson(envelope);
    if (!isPlainObject(envelope)) throw new Error("バックアップ全体の型が不正です。");
    if (envelope.format !== FORMAT) throw new Error("HAPICHIKEのバックアップ形式ではありません。");
    if (!Object.prototype.hasOwnProperty.call(envelope, "version")) throw new Error("versionのない旧形式は復元できません。");
    if (![LEGACY_VERSION, VERSION].includes(envelope.version)) throw new Error(`未対応のbackup versionです（対応: ${LEGACY_VERSION}, ${VERSION}）。`);
    if (envelope.app !== APP) throw new Error("対象アプリが一致しません。");
    if (typeof envelope.createdAt !== "string" || !Number.isFinite(Date.parse(envelope.createdAt))) throw new Error("backup日時が不正です。");
    if (!isPlainObject(envelope.data)) throw new Error("dataがありません。");
    if (!Object.prototype.hasOwnProperty.call(envelope.data, STORAGE_KEY)) throw new Error(`${STORAGE_KEY} がありません。`);
    if (!Object.prototype.hasOwnProperty.call(envelope.data, EMAIL_KEY)) throw new Error(`${EMAIL_KEY} がありません。`);

    const main = envelope.data[STORAGE_KEY];
    if (!isPlainObject(main)) throw new Error(`${STORAGE_KEY} はオブジェクトである必要があります。`);
    if (containsSecretKey(main)) throw new Error("passwordまたは認証情報を含むバックアップは復元できません。");
    if (typeof main.childName !== "string") throw new Error("childNameの型が不正です。");
    requireFiniteNumber(main.coins, "coins");
    requireFiniteNumber(main.starCoins, "starCoins");
    requireFiniteNumber(main.happyChanceCards, "happyChanceCards");
    if (!isPlainObject(main.points)) throw new Error("pointsの型が不正です。");
    ["snack", "toy", "game"].forEach(key => requireFiniteNumber(main.points[key], `points.${key}`));
    ["tasks", "todayTasks", "history"].forEach(key => {
      if (!Array.isArray(main[key])) throw new Error(`${key} は配列である必要があります。`);
    });
    ARRAY_FIELDS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(main, key) && !Array.isArray(main[key])) throw new Error(`${key} は配列である必要があります。`);
    });
    main.tasks.forEach((task, index) => {
      if (!isPlainObject(task) || typeof task.id !== "string" || typeof task.title !== "string") throw new Error(`tasks[${index}] の型が不正です。`);
      if (Object.prototype.hasOwnProperty.call(task, "ticketReward")) requireFiniteNumber(task.ticketReward, `tasks[${index}].ticketReward`);
      if (Object.prototype.hasOwnProperty.call(task, "starCoinReward")) requireFiniteNumber(task.starCoinReward, `tasks[${index}].starCoinReward`);
    });
    main.todayTasks.forEach((task, index) => {
      if (!isPlainObject(task) || typeof task.taskId !== "string") throw new Error(`todayTasks[${index}] の型が不正です。`);
    });
    if (Object.prototype.hasOwnProperty.call(main, "audioSettings")) {
      if (!isPlainObject(main.audioSettings)) throw new Error("audioSettingsの型が不正です。");
      ["bgmEnabled", "sfxEnabled"].forEach(key => {
        if (typeof main.audioSettings[key] !== "boolean") throw new Error(`audioSettings.${key} の型が不正です。`);
      });
      ["bgmVolume", "sfxVolume"].forEach(key => requireFiniteNumber(main.audioSettings[key], `audioSettings.${key}`));
    }
    if (typeof envelope.data[EMAIL_KEY] !== "string") throw new Error(`${EMAIL_KEY} は文字列である必要があります。`);
    if (envelope.version === VERSION) {
      if (!Object.prototype.hasOwnProperty.call(envelope.data, V2_STORAGE_KEY)) throw new Error(`${V2_STORAGE_KEY} がありません。`);
      const v2 = envelope.data[V2_STORAGE_KEY];
      if (containsSecretKey(v2)) throw new Error("認証情報を含むv2バックアップは復元できません。");
      parseV2Store(JSON.stringify(v2));
    }
    return envelope;
  }

  function containsSecretKey(value) {
    if (Array.isArray(value)) return value.some(containsSecretKey);
    if (!isPlainObject(value)) return false;
    return Object.keys(value).some(key => SECRET_KEY_PATTERN.test(key) || containsSecretKey(value[key]));
  }

  function preview(envelope, currentState) {
    validateEnvelope(envelope);
    const backup = envelope.data[STORAGE_KEY];
    const current = isPlainObject(currentState) ? currentState : {};
    const countHistory = value => Array.isArray(value?.history) ? value.history.length : 0;
    const v2 = envelope.version === VERSION ? envelope.data[V2_STORAGE_KEY] : null;
    return {
      createdAt: envelope.createdAt,
      version: envelope.version,
      childName: backup.childName || "未設定",
      profileCount: v2 ? Object.keys(v2.profiles).length : 0,
      activeLocalChildKey: v2?.activeLocalChildKey ?? null,
      householdShared: v2?.householdShared ?? null,
      rows: [
        ["tickets", current.coins, backup.coins],
        ["starCoins", current.starCoins, backup.starCoins],
        ["SweetsPAY", current.points?.snack, backup.points.snack],
        ["ToyPAY", current.points?.toy, backup.points.toy],
        ["GamePAY", current.points?.game, backup.points.game],
        ["Happy Chance", current.happyChanceCards, backup.happyChanceCards],
        ["task件数", current.tasks?.length, backup.tasks.length],
        ["history件数", countHistory(current), countHistory(backup)],
        ["settings", Boolean(current.audioSettings), Boolean(backup.audioSettings)]
      ]
    };
  }

  function restore(storage, envelope, createdAt = new Date().toISOString()) {
    validateEnvelope(envelope);
    const oldMainRaw = storage.getItem(STORAGE_KEY);
    const oldEmailRaw = storage.getItem(EMAIL_KEY);
    const oldSafetyRaw = storage.getItem(SAFETY_KEY);
    const oldV2Raw = storage.getItem(V2_STORAGE_KEY);
    const oldMain = parseMainState(oldMainRaw);
    const oldV2 = parseV2Store(oldV2Raw);
    const safetyEnvelope = makeEnvelope(oldMain, oldEmailRaw || "", createdAt, oldV2);
    const restoredMain = stripSecrets(envelope.data[STORAGE_KEY]);
    if (typeof oldMain.parentPassword === "string") restoredMain.parentPassword = oldMain.parentPassword;
    const nextMainRaw = JSON.stringify(restoredMain);
    const nextEmailRaw = envelope.data[EMAIL_KEY];
    const nextSafetyRaw = JSON.stringify(safetyEnvelope);
    const nextV2Raw = envelope.version === VERSION ? JSON.stringify(stripSecrets(envelope.data[V2_STORAGE_KEY])) : oldV2Raw;

    try {
      storage.setItem(SAFETY_KEY, nextSafetyRaw);
      storage.setItem(STORAGE_KEY, nextMainRaw);
      storage.setItem(EMAIL_KEY, nextEmailRaw);
      if (envelope.version === VERSION) storage.setItem(V2_STORAGE_KEY, nextV2Raw);
      if (storage.getItem(STORAGE_KEY) !== nextMainRaw || storage.getItem(EMAIL_KEY) !== nextEmailRaw
        || (envelope.version === VERSION && storage.getItem(V2_STORAGE_KEY) !== nextV2Raw)) throw new Error("復元後の読み戻し確認に失敗しました。");
      return { safetyKey: SAFETY_KEY };
    } catch (error) {
      try {
        restoreRaw(storage, STORAGE_KEY, oldMainRaw);
        restoreRaw(storage, EMAIL_KEY, oldEmailRaw);
        restoreRaw(storage, SAFETY_KEY, oldSafetyRaw);
        restoreRaw(storage, V2_STORAGE_KEY, oldV2Raw);
      } catch (rollbackError) {
        throw new Error(`復元と自動ロールバックに失敗しました: ${error.message}`);
      }
      throw new Error(`復元に失敗したため、元の端末データを維持しました: ${error.message}`);
    }
  }

  function restoreRaw(storage, key, value) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }

  function filename(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return `hapichike-backup-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}.json`;
  }

  return { FORMAT, LEGACY_VERSION, VERSION, APP, STORAGE_KEY, V2_STORAGE_KEY, EMAIL_KEY, SAFETY_KEY, parseMainState, parseV2Store, createBackup, parseBackup, validateEnvelope, preview, restore, filename, stripSecrets };
});
