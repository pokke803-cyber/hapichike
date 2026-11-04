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
  const MAPPING_V2_STORAGE_KEY = "kidsVegasCasino.cloudMapping.v2";
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

  function emptyV2MappingDocument() {
    return { appId: APP_ID, version: 2, mappings: [] };
  }

  function parseV2MappingDocument(raw) {
    if (raw === null || raw === undefined || raw === "") return emptyV2MappingDocument();
    let document;
    try { document = JSON.parse(raw); }
    catch { throw new Error("保存済みのv2対応付け情報が壊れています。"); }
    if (!isPlainObject(document) || document.appId !== APP_ID || document.version !== 2 || !Array.isArray(document.mappings)) {
      throw new Error("保存済みのv2対応付け形式に対応していません。");
    }
    const mappings = document.mappings.map(mapping => {
      if (!isPlainObject(mapping) || typeof mapping.localChildKey !== "string" || !mapping.localChildKey
        || typeof mapping.supabaseChildId !== "string" || !mapping.supabaseChildId
        || typeof mapping.householdId !== "string" || !mapping.householdId
        || typeof mapping.confirmedAt !== "string") throw new Error("保存済みのv2対応付け情報が不正です。");
      return { ...mapping };
    });
    return { appId: APP_ID, version: 2, mappings };
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

  function createMappingPreview({ localProfile, cloudChild, householdId, visibleChildren, mappingRaw }) {
    if (!localProfile || typeof localProfile.localChildKey !== "string" || !localProfile.localChildKey) {
      throw new Error("LOCAL_INVALID");
    }
    if (!cloudChild || typeof cloudChild.id !== "string" || !cloudChild.id) throw new Error("CHILD_LOAD_FAILED");
    if (typeof householdId !== "string" || !householdId) throw new Error("HOUSEHOLD_LOAD_FAILED");
    if (cloudChild.householdId !== householdId) throw new Error("MAPPING_CONFLICT");
    if (!(visibleChildren ?? []).some(child => child.id === cloudChild.id && child.householdId === householdId)) {
      throw new Error("CHILD_LOAD_FAILED");
    }
    const document = parseMappingDocument(mappingRaw);
    const cloudConflict = document.mappings.find(item => item.supabaseChildId === cloudChild.id && item.localChildKey !== localProfile.localChildKey);
    if (cloudConflict) throw new Error("MAPPING_CONFLICT");
    return {
      localChildKey: localProfile.localChildKey,
      localDisplayName: String(localProfile.displayName || localProfile.name || "名前未設定"),
      supabaseChildId: cloudChild.id,
      cloudDisplayName: String(cloudChild.displayName || "名前未設定"),
      householdId,
      sourceMappingRaw: mappingRaw ?? null,
      message: `Local ${String(localProfile.displayName || localProfile.name || "名前未設定")} を Cloud ${String(cloudChild.displayName || "名前未設定")} に対応付けます`,
    };
  }

  function saveVerifiedMapping(storage, preview, context, confirmedAt = new Date().toISOString()) {
    if (!preview || context?.parentApproved !== true) throw new Error("親の明示確認が必要です。");
    const currentRaw = storage.getItem(MAPPING_STORAGE_KEY);
    if ((currentRaw ?? null) !== (preview.sourceMappingRaw ?? null)) throw new Error("CHILD_LOAD_FAILED");
    const refreshed = createMappingPreview({
      localProfile: context.localProfile,
      cloudChild: context.cloudChild,
      householdId: context.householdId,
      visibleChildren: context.visibleChildren,
      mappingRaw: currentRaw,
    });
    if (refreshed.localChildKey !== preview.localChildKey || refreshed.supabaseChildId !== preview.supabaseChildId
      || refreshed.householdId !== preview.householdId) throw new Error("MAPPING_CONFLICT");
    return saveMapping(storage, refreshed, confirmedAt);
  }

  function createV2MappingPreview({ localProfile, cloudChild, householdId, visibleChildren, mappingRaw }) {
    if (localProfile?.localChildKey === LOCAL_CHILD_KEY) throw new Error("LOCAL_INVALID");
    const preview = createMappingPreview({ localProfile, cloudChild, householdId, visibleChildren, mappingRaw: null });
    const document = parseV2MappingDocument(mappingRaw);
    const cloudConflict = document.mappings.find(item => item.supabaseChildId === cloudChild.id && item.localChildKey !== localProfile.localChildKey);
    if (cloudConflict) throw new Error("MAPPING_CONFLICT");
    return { ...preview, sourceMappingRaw: mappingRaw ?? null, mappingVersion: 2 };
  }

  function saveVerifiedV2Mapping(storage, preview, context, confirmedAt = new Date().toISOString()) {
    if (!preview || preview.mappingVersion !== 2 || context?.parentApproved !== true) throw new Error("親の明示確認が必要です。");
    const currentRaw = storage.getItem(MAPPING_V2_STORAGE_KEY);
    if ((currentRaw ?? null) !== (preview.sourceMappingRaw ?? null)) throw new Error("CHILD_LOAD_FAILED");
    const refreshed = createV2MappingPreview({
      localProfile: context.localProfile, cloudChild: context.cloudChild, householdId: context.householdId,
      visibleChildren: context.visibleChildren, mappingRaw: currentRaw,
    });
    if (refreshed.localChildKey !== preview.localChildKey || refreshed.supabaseChildId !== preview.supabaseChildId
      || refreshed.householdId !== preview.householdId) throw new Error("MAPPING_CONFLICT");
    const document = parseV2MappingDocument(currentRaw);
    const mappings = document.mappings.filter(item => item.localChildKey !== refreshed.localChildKey);
    if (mappings.some(item => item.supabaseChildId === refreshed.supabaseChildId)) throw new Error("MAPPING_CONFLICT");
    mappings.push({ localChildKey: refreshed.localChildKey, supabaseChildId: refreshed.supabaseChildId, householdId: refreshed.householdId, confirmedAt });
    const next = { appId: APP_ID, version: 2, mappings };
    const raw = JSON.stringify(next);
    storage.setItem(MAPPING_V2_STORAGE_KEY, raw);
    if (storage.getItem(MAPPING_V2_STORAGE_KEY) !== raw) throw new Error("MAPPING_CONFLICT");
    return next;
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
    MAPPING_V2_STORAGE_KEY,
    LOCAL_CHILD_KEY,
    BALANCE_FIELDS,
    parseLocalState,
    readLocalChild,
    parseMappingDocument,
    parseV2MappingDocument,
    readMapping,
    saveMapping,
    createMappingPreview,
    saveVerifiedMapping,
    createV2MappingPreview,
    saveVerifiedV2Mapping,
    findVerifiedMapping,
    compareBalances,
    getImportReadiness,
    createImportPayloadProposal,
  };
});
