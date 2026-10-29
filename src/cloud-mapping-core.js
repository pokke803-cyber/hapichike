(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeCloudMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APP_ID = "hapichike";
  const MAPPING_VERSION = 1;
  const MAIN_STORAGE_KEY = "kidsVegasCasino.v1";
  const MAPPING_STORAGE_KEY = "kidsVegasCasino.cloudMapping.v1";
  const LOCAL_CHILD_KEY = "legacy-single-profile";
  const BALANCE_FIELDS = [
    { key: "tickets", label: "Tickets", local: state => state.coins, cloud: balance => balance.tickets },
    { key: "star_coins", label: "Star Coins", local: state => state.starCoins, cloud: balance => balance.star_coins },
    { key: "sweets_pay", label: "SweetsPAY", local: state => state.points.snack, cloud: balance => balance.sweets_pay },
    { key: "toy_pay", label: "ToyPAY", local: state => state.points.toy, cloud: balance => balance.toy_pay },
    { key: "game_pay", label: "GamePAY", local: state => state.points.game, cloud: balance => balance.game_pay },
    { key: "happy_chance_cards", label: "Happy Chance", local: state => state.happyChanceCards, cloud: balance => balance.happy_chance_cards },
  ];

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function requireBalance(value, path, nonNegative) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || (nonNegative && value < 0)) {
      throw new Error(`${path} は${nonNegative ? "0以上の" : "有限の"}整数である必要があります。`);
    }
    return value;
  }

  function parseLocalState(raw) {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("ローカルデータが見つかりません。");
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      throw new Error("ローカルデータのJSONが壊れています。");
    }
    if (!isPlainObject(state) || !isPlainObject(state.points)) {
      throw new Error("ローカルデータの形式が正しくありません。");
    }

    const childName = typeof state.childName === "string" ? state.childName.trim() : "";
    const balances = {};
    BALANCE_FIELDS.forEach(field => {
      balances[field.key] = requireBalance(
        field.local(state),
        field.key,
        field.key === "star_coins" || field.key === "happy_chance_cards",
      );
    });
    return {
      localChildKey: LOCAL_CHILD_KEY,
      name: childName || "名前未設定",
      balances,
    };
  }

  function readLocalChild(storage) {
    return parseLocalState(storage.getItem(MAIN_STORAGE_KEY));
  }

  function emptyMappingDocument() {
    return { appId: APP_ID, version: MAPPING_VERSION, mappings: [] };
  }

  function parseMappingDocument(raw) {
    if (raw === null || raw === undefined || raw === "") return emptyMappingDocument();
    let document;
    try {
      document = JSON.parse(raw);
    } catch {
      throw new Error("保存済みの対応付け情報が壊れています。");
    }
    if (!isPlainObject(document) || document.appId !== APP_ID || document.version !== MAPPING_VERSION || !Array.isArray(document.mappings)) {
      throw new Error("保存済みの対応付け形式に対応していません。");
    }
    const mappings = document.mappings.map(mapping => {
      if (!isPlainObject(mapping)
        || typeof mapping.localChildKey !== "string"
        || typeof mapping.supabaseChildId !== "string"
        || typeof mapping.householdId !== "string"
        || typeof mapping.confirmedAt !== "string") {
        throw new Error("保存済みの対応付け情報が不正です。");
      }
      return { ...mapping };
    });
    return { appId: APP_ID, version: MAPPING_VERSION, mappings };
  }

  function readMapping(storage) {
    return parseMappingDocument(storage.getItem(MAPPING_STORAGE_KEY));
  }

  function saveMapping(storage, { localChildKey, supabaseChildId, householdId }, confirmedAt = new Date().toISOString()) {
    if (![localChildKey, supabaseChildId, householdId].every(value => typeof value === "string" && value)) {
      throw new Error("対応付けの保存内容が不足しています。");
    }
    const document = readMapping(storage);
    const nextMapping = { localChildKey, supabaseChildId, householdId, confirmedAt };
    const mappings = document.mappings.filter(mapping => mapping.localChildKey !== localChildKey);
    if (mappings.some(mapping => mapping.supabaseChildId === supabaseChildId)) {
      throw new Error("同じクラウドChildは複数のローカルChildへ割り当てられません。");
    }
    mappings.push(nextMapping);
    const nextDocument = { appId: APP_ID, version: MAPPING_VERSION, mappings };
    storage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(nextDocument));
    return nextDocument;
  }

  function findVerifiedMapping(document, localChildKey, householdId, visibleChildren) {
    const mapping = document.mappings.find(item => item.localChildKey === localChildKey && item.householdId === householdId);
    if (!mapping) return null;
    return visibleChildren.some(child => child.id === mapping.supabaseChildId) ? mapping : null;
  }

  function compareBalances(localChild, cloudBalance) {
    return BALANCE_FIELDS.map(field => {
      const local = localChild.balances[field.key];
      const cloudRaw = cloudBalance?.[field.key];
      const cloud = Number.isFinite(Number(cloudRaw)) ? Number(cloudRaw) : null;
      const difference = cloud === null ? null : local - cloud;
      const status = cloud === null ? "missing" : difference === 0 ? "equal" : difference > 0 ? "local-greater" : "cloud-greater";
      return { key: field.key, label: field.label, local, cloud, difference, status };
    });
  }

  function getImportReadiness(rows) {
    if (!rows?.length || rows.some(row => row.cloud === null)) return "Cloud balance missing";
    if (rows.some(row => row.cloud !== 0)) return "Cloud already initialized";
    return "Ready";
  }

  function createImportPayloadProposal(localChild, supabaseChildId, options = {}) {
    return {
      child_id: supabaseChildId,
      app_id: APP_ID,
      import_id: options.importId ?? "<phase-2-generated-uuid>",
      import_version: 1,
      source_snapshot_hash: options.sourceSnapshotHash ?? "<phase-2-canonical-sha256>",
      balances: { ...localChild.balances },
    };
  }

  return {
    APP_ID,
    MAPPING_VERSION,
    MAIN_STORAGE_KEY,
    MAPPING_STORAGE_KEY,
    LOCAL_CHILD_KEY,
    BALANCE_FIELDS,
    parseLocalState,
    readLocalChild,
    parseMappingDocument,
    readMapping,
    saveMapping,
    findVerifiedMapping,
    compareBalances,
    getImportReadiness,
    createImportPayloadProposal,
  };
});
