(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeInitialImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APP_ID = "hapichike";
  const IMPORT_VERSION = 1;
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
    const backupDate = new Date(backupCreatedAt);
    if (!backupCreatedAt || Number.isNaN(backupDate.getTime())) {
      throw new Error("検証済みbackupの作成日時が必要です。");
    }
    if (backupDate.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new Error("backup作成日時が未来になっています。");
    }
    if (parentApproved !== true) throw new Error("親の明示承認が必要です。");
    return {
      childId: childId.trim(),
      balances: validateSnapshotBalances(balances),
      backupCreatedAt: backupDate.toISOString(),
    };
  }

  async function createInitialImportPreview(input, options = {}) {
    const validated = validatePreviewInput(input);
    const canonicalSnapshot = canonicalizeSnapshot(validated.balances);
    const sourceSnapshotHash = await sha256Hex(canonicalSnapshot, options.cryptoApi);
    const randomUUID = options.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (typeof randomUUID !== "function") throw new Error("安全なUUID生成機能が必要です。");

    return {
      child_id: validated.childId,
      import_id: options.importId || randomUUID(),
      import_version: IMPORT_VERSION,
      source_snapshot_hash: sourceSnapshotHash,
      balances: validated.balances,
      backup_created_at: validated.backupCreatedAt,
      parent_approved: true,
      canonical_snapshot: canonicalSnapshot,
    };
  }

  return {
    APP_ID,
    IMPORT_VERSION,
    BALANCE_KEYS,
    validateSnapshotBalances,
    canonicalizeSnapshot,
    sha256Hex,
    validatePreviewInput,
    createInitialImportPreview,
  };
});
