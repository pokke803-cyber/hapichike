(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeInitialImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APP_ID = "hapichike";
  const IMPORT_VERSION = 1;
  const BACKUP_METADATA_KEY = "kidsVegasCasino.initialImportBackup.v1";
  const PENDING_IMPORT_KEY = "kidsVegasCasino.pendingInitialImport.v1";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BALANCE_KEYS = [
    "tickets",
    "star_coins",
    "sweets_pay",
    "toy_pay",
    "game_pay",
    "happy_chance_cards",
  ];

  function requireInteger(value, key, { nonNegative = false } = {}) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${key} は有限の整数である必要があります。`);
    }
    if (nonNegative && value < 0) {
      throw new Error(`${key} は0以上である必要があります。`);
    }
    return value;
  }

  function validateSnapshotBalances(balances) {
    if (!balances || typeof balances !== "object" || Array.isArray(balances)) {
      throw new Error("6残高のsnapshotが必要です。");
    }

    const snapshot = {};
    BALANCE_KEYS.forEach(key => {
      snapshot[key] = requireInteger(balances[key], key, {
        nonNegative: key === "star_coins" || key === "happy_chance_cards",
      });
    });
    return snapshot;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeBackupCreatedAt(value) {
    const backupDate = new Date(value);
    if (!value || Number.isNaN(backupDate.getTime())) {
      throw new Error("検証済みbackupの作成日時が必要です。");
    }
    if (backupDate.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new Error("backup作成日時が未来になっています。");
    }
    return backupDate.toISOString();
  }

  function recordBackupMetadata(storage, createdAt, balances) {
    const canonicalSnapshot = canonicalizeSnapshot(balances);
    const metadata = {
      app_id: APP_ID,
      version: 1,
      backup_created_at: normalizeBackupCreatedAt(createdAt),
      canonical_snapshot: canonicalSnapshot,
    };
    storage.setItem(BACKUP_METADATA_KEY, JSON.stringify(metadata));
    return metadata;
  }

  function readBackupMetadata(storage) {
    const raw = storage.getItem(BACKUP_METADATA_KEY);
    if (!raw) return null;
    try {
      const metadata = JSON.parse(raw);
      if (!isPlainObject(metadata)
        || metadata.app_id !== APP_ID
        || metadata.version !== 1
        || typeof metadata.canonical_snapshot !== "string") return null;
      return {
        ...metadata,
        backup_created_at: normalizeBackupCreatedAt(metadata.backup_created_at),
      };
    } catch {
      return null;
    }
  }

  function isBackupCurrent(metadata, balances) {
    if (!metadata) return false;
    try {
      return metadata.canonical_snapshot === canonicalizeSnapshot(balances);
    } catch {
      return false;
    }
  }

  function canonicalizeSnapshot(balances, importVersion = IMPORT_VERSION) {
    if (importVersion !== IMPORT_VERSION) throw new Error("未対応のimport versionです。");
    const snapshot = validateSnapshotBalances(balances);
    return JSON.stringify({
      app_id: APP_ID,
      import_version: importVersion,
      balances: snapshot,
    });
  }

  async function sha256Hex(value, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle || typeof TextEncoder === "undefined") {
      throw new Error("SHA-256を利用できる環境が必要です。");
    }
    const bytes = new TextEncoder().encode(value);
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function validatePreviewInput({ childId, balances, backupCreatedAt, parentApproved }) {
    if (typeof childId !== "string" || !childId.trim()) throw new Error("対象childが必要です。");
    if (parentApproved !== true) throw new Error("親の明示承認が必要です。");
    return {
      childId: childId.trim(),
      balances: validateSnapshotBalances(balances),
      backupCreatedAt: normalizeBackupCreatedAt(backupCreatedAt),
    };
  }

  async function createInitialImportPreview(input, options = {}) {
    const validated = validatePreviewInput(input);
    const canonicalSnapshot = canonicalizeSnapshot(validated.balances);
    const sourceSnapshotHash = await sha256Hex(canonicalSnapshot, options.cryptoApi);
    const randomUUID = options.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (typeof randomUUID !== "function") throw new Error("安全なUUID生成機能が必要です。");

    const importId = options.importId || randomUUID();
    if (typeof importId !== "string" || !UUID_PATTERN.test(importId)) {
      throw new Error("import_idはUUIDである必要があります。");
    }

    return {
      child_id: validated.childId,
      import_id: importId,
      import_version: IMPORT_VERSION,
      source_snapshot_hash: sourceSnapshotHash,
      balances: validated.balances,
      backup_created_at: validated.backupCreatedAt,
      parent_approved: true,
      app_id: APP_ID,
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "初回データ移行",
      metadata: isPlainObject(input.metadata) ? { ...input.metadata } : {},
      canonical_snapshot: canonicalSnapshot,
    };
  }

  function validatePendingPreview(preview) {
    if (!isPlainObject(preview)
      || preview.app_id !== APP_ID
      || preview.import_version !== IMPORT_VERSION
      || typeof preview.child_id !== "string"
      || typeof preview.import_id !== "string"
      || !UUID_PATTERN.test(preview.import_id)
      || !/^[0-9a-f]{64}$/.test(preview.source_snapshot_hash ?? "")
      || preview.parent_approved !== true) {
      throw new Error("保留中の初回import情報が不正です。");
    }
    const balances = validateSnapshotBalances(preview.balances);
    const canonicalSnapshot = canonicalizeSnapshot(balances);
    if (preview.canonical_snapshot !== canonicalSnapshot) {
      throw new Error("保留中の初回import payloadが一致しません。");
    }
    return {
      ...preview,
      balances,
      backup_created_at: normalizeBackupCreatedAt(preview.backup_created_at),
      title: typeof preview.title === "string" && preview.title.trim() ? preview.title.trim() : "初回データ移行",
      metadata: isPlainObject(preview.metadata) ? { ...preview.metadata } : {},
      canonical_snapshot: canonicalSnapshot,
    };
  }

  function savePendingPreview(storage, preview) {
    const validated = validatePendingPreview(preview);
    storage.setItem(PENDING_IMPORT_KEY, JSON.stringify(validated));
    return validated;
  }

  function readPendingPreview(storage) {
    const raw = storage.getItem(PENDING_IMPORT_KEY);
    if (!raw) return null;
    try {
      return validatePendingPreview(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function clearPendingPreview(storage) {
    storage.removeItem(PENDING_IMPORT_KEY);
  }

  async function matchesPreview(preview, input, options = {}) {
    let validatedPreview;
    let validatedInput;
    try {
      validatedPreview = validatePendingPreview(preview);
      validatedInput = validatePreviewInput({ ...input, parentApproved: true });
    } catch {
      return false;
    }
    if (validatedPreview.child_id !== validatedInput.childId
      || validatedPreview.backup_created_at !== validatedInput.backupCreatedAt
      || validatedPreview.canonical_snapshot !== canonicalizeSnapshot(validatedInput.balances)) {
      return false;
    }
    return validatedPreview.source_snapshot_hash === await sha256Hex(validatedPreview.canonical_snapshot, options.cryptoApi);
  }

  function evaluateReadiness(input = {}) {
    const roleAllowed = input.role === "owner" || input.role === "parent";
    const balances = input.cloudBalance;
    const cloudBalancesZero = Boolean(balances) && BALANCE_KEYS.every(key => Number(balances[key]) === 0);
    const initializationKnown = input.syncStateLoaded === true
      && input.cloudBalanceLoaded === true
      && input.rewardLogsLoaded === true
      && Boolean(balances);
    const cloudUninitialized = initializationKnown
      && input.syncState === null
      && cloudBalancesZero
      && input.rewardLogCount === 0;
    const importComplete = Boolean(input.syncState?.initial_import_completed_at);
    const checks = {
      loggedIn: input.loggedIn === true,
      household: input.household === true,
      localChild: input.localChild === true,
      mapping: input.mapping === true,
      backup: input.backup === true,
      backupCurrent: input.backupCurrent === true,
      localSnapshot: input.localSnapshot === true,
      cloudBalance: input.cloudBalanceLoaded === true,
      syncState: input.syncStateLoaded === true && input.rewardLogsLoaded === true,
      cloudUninitialized,
      authorizedRole: roleAllowed,
      importNotComplete: !importComplete,
    };
    return {
      checks,
      ready: Object.values(checks).every(Boolean),
      cloudInitialized: initializationKnown && !cloudUninitialized,
      importComplete,
    };
  }

  function approvalsComplete(approvals) {
    return approvals?.backup === true
      && approvals?.mapping === true
      && approvals?.snapshot === true
      && approvals?.oneTime === true;
  }

  function canExecuteImport(readiness, approvals, importing = false) {
    return readiness?.ready === true
      && readiness?.importComplete !== true
      && approvalsComplete(approvals)
      && importing !== true;
  }

  return {
    APP_ID,
    IMPORT_VERSION,
    BACKUP_METADATA_KEY,
    PENDING_IMPORT_KEY,
    BALANCE_KEYS,
    validateSnapshotBalances,
    canonicalizeSnapshot,
    sha256Hex,
    validatePreviewInput,
    createInitialImportPreview,
    recordBackupMetadata,
    readBackupMetadata,
    isBackupCurrent,
    validatePendingPreview,
    savePendingPreview,
    readPendingPreview,
    clearPendingPreview,
    matchesPreview,
    evaluateReadiness,
    approvalsComplete,
    canExecuteImport,
  };
});
