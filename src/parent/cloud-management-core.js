(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports && typeof require === "function";
  const mapping = commonJs ? require("../cloud-mapping-core.js") : root.HapichikeCloudMapping;
  const identity = commonJs ? require("../child-identity-core.js") : root.HapichikeChildIdentity;
  const importCore = commonJs ? require("../initial-import-core.js") : root.HapichikeInitialImport;
  const migration = commonJs ? require("../profile-migration.js") : root.HapichikeProfileMigration;
  const api = factory(mapping, identity, importCore, migration);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeParentCloudManagement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (mapping, identity, importCore, migration) {
  "use strict";

  const V1_KEY = "kidsVegasCasino.v1";
  const V2_KEY = "kidsVegasCasino.v2";
  const MAPPING_KEY = "kidsVegasCasino.cloudMapping.v1";
  const MAPPING_V2_KEY = "kidsVegasCasino.cloudMapping.v2";
  const BALANCE_ROWS = Object.freeze([
    ["tickets", "Tickets", "tickets"],
    ["starCoins", "Star Coins", "star_coins"],
    ["sweetsPay", "SweetsPAY", "sweets_pay"],
    ["toyPay", "ToyPAY", "toy_pay"],
    ["gamePay", "GamePAY", "game_pay"],
    ["happyChanceCards", "Happy Chance", "happy_chance_cards"],
  ]);

  function safeGet(storage, key) {
    try { return { raw: storage?.getItem(key) ?? null, error: false }; }
    catch { return { raw: null, error: true }; }
  }

  function profileBalances(profile) {
    if (!profile) return null;
    const values = {
      tickets: profile.coins,
      starCoins: profile.starCoins,
      sweetsPay: profile.points?.snack,
      toyPay: profile.points?.toy,
      gamePay: profile.points?.game,
      happyChanceCards: profile.happyChanceCards,
    };
    return Object.values(values).every(Number.isFinite) ? values : null;
  }

  function legacyBalances(localChild) {
    if (!localChild) return null;
    return {
      tickets: localChild.balances.tickets,
      starCoins: localChild.balances.star_coins,
      sweetsPay: localChild.balances.sweets_pay,
      toyPay: localChild.balances.toy_pay,
      gamePay: localChild.balances.game_pay,
      happyChanceCards: localChild.balances.happy_chance_cards,
    };
  }

  function compare(local, cloud) {
    if (!local) return [];
    return BALANCE_ROWS.map(([localKey, label, cloudKey]) => {
      const localValue = local[localKey];
      const cloudValue = cloud && Number.isFinite(Number(cloud[cloudKey])) ? Number(cloud[cloudKey]) : null;
      return { key: cloudKey, label, local: localValue, cloud: cloudValue, difference: cloudValue === null ? null : localValue - cloudValue };
    });
  }

  function inspect(storage, runtimeState) {
    const selectedId = runtimeState.parentViewedSupabaseChildId;
    const selectedChild = runtimeState.cloudChildren.items.find(child => child.id === selectedId) ?? null;
    const v1 = safeGet(storage, V1_KEY);
    const v2 = safeGet(storage, V2_KEY);
    const mappingV2Raw = safeGet(storage, MAPPING_V2_KEY);
    const mappingV1Raw = safeGet(storage, MAPPING_KEY);
    const useV2 = Boolean(mappingV2Raw.raw) || mappingV2Raw.error;
    const mappingRaw = useV2 ? mappingV2Raw : mappingV1Raw;
    let legacy = null;
    let store = null;
    let mappingDocument = null;
    let mappingStatus = mappingRaw.error ? "invalid" : "missing";
    try { if (v1.raw) legacy = mapping.parseLocalState(v1.raw); } catch { /* status is already supplied by runtime */ }
    try { if (v2.raw) store = identity.parseStore(v2.raw); } catch { /* status is already supplied by runtime */ }
    try {
      mappingDocument = useV2 ? mapping.parseV2MappingDocument(mappingRaw.raw) : mapping.parseMappingDocument(mappingRaw.raw);
      mappingStatus = mappingDocument.mappings.length ? "stale" : "missing";
    } catch { mappingStatus = "invalid"; }

    const mappings = mappingDocument?.mappings ?? [];
    const householdMappings = mappings.filter(item => item.householdId === runtimeState.selectedHouseholdId);
    const selectedMapping = householdMappings.find(item => item.supabaseChildId === selectedId)
      ?? householdMappings.find(item => item.localChildKey === store?.activeLocalChildKey)
      ?? householdMappings.find(item => item.localChildKey === mapping.LOCAL_CHILD_KEY)
      ?? householdMappings[0]
      ?? null;
    const householdMatches = Boolean(selectedMapping && selectedMapping.householdId === runtimeState.selectedHouseholdId);
    const mappedChildVisible = Boolean(selectedMapping && runtimeState.cloudChildren.items.some(child => child.id === selectedMapping.supabaseChildId));
    if (selectedMapping && householdMatches && mappedChildVisible) mappingStatus = "valid";
    const viewedChildMatches = Boolean(selectedMapping && selectedMapping.supabaseChildId === selectedId);

    let localProfile = null;
    let localSource = null;
    if (viewedChildMatches && selectedMapping.localChildKey === mapping.LOCAL_CHILD_KEY && legacy) {
      localProfile = legacyBalances(legacy);
      localSource = "Legacy v1";
    } else if (viewedChildMatches && store?.profiles?.[selectedMapping?.localChildKey]) {
      localProfile = profileBalances(store.profiles[selectedMapping.localChildKey]);
      localSource = "v2 profile";
    }
    const comparison = compare(localProfile, runtimeState.viewedChildBalance);
    const mismatch = comparison.some(row => row.difference !== null && row.difference !== 0);

    const backupMetadata = importCore.readBackupMetadata(storage);
    const importBalances = localProfile ? Object.fromEntries(BALANCE_ROWS.map(([localKey, , cloudKey]) => [cloudKey, localProfile[localKey]])) : null;
    const backupCurrent = Boolean(backupMetadata && importBalances && importCore.isBackupCurrent(backupMetadata, importBalances));
    const syncStateLoaded = runtimeState.viewedChildData.status === "ready";
    const readiness = importCore.evaluateReadiness({
      loggedIn: runtimeState.auth.status === "signed_in",
      household: Boolean(runtimeState.selectedHouseholdId),
      localChild: Boolean(localProfile), mapping: viewedChildMatches && mappingStatus === "valid",
      backup: Boolean(backupMetadata), backupCurrent, localSnapshot: Boolean(importBalances),
      cloudBalanceLoaded: syncStateLoaded && Boolean(runtimeState.viewedChildBalance),
      cloudBalance: runtimeState.viewedChildBalance,
      syncStateLoaded, syncState: runtimeState.viewedChildSyncState,
      rewardLogsLoaded: syncStateLoaded, rewardLogCount: runtimeState.viewedChildRewardLogs.length,
      role: runtimeState.households.items?.find(item => item.id === runtimeState.selectedHouseholdId)?.membershipRole ?? "viewer",
    });

    return {
      selectedChild,
      mapping: { status: mappingStatus, version: useV2 ? 2 : 1, item: selectedMapping, householdMatches, mappedChildVisible, viewedChildMatches },
      localProfile: { source: localSource, balances: localProfile, unresolved: !localProfile },
      comparison, mismatch,
      backup: { present: Boolean(backupMetadata), current: backupCurrent, metadata: backupMetadata },
      initialImport: { syncState: runtimeState.viewedChildSyncState, readiness },
      diagnostic: {
        auth: runtimeState.auth.status, household: runtimeState.households.status,
        childList: runtimeState.cloudChildren.status, childDetails: runtimeState.viewedChildData.status,
        localV1: runtimeState.local.legacyStatus, localV2: runtimeState.local.v2Status,
        mapping: mappingStatus, syncState: syncStateLoaded ? (runtimeState.viewedChildSyncState ? "あり" : "なし") : "未確認",
      },
    };
  }

  function previewLegacy(storage, selectedChild, cloudBalance) {
    if (!selectedChild?.id) throw new Error("表示中のCloud Childを選択してください。");
    const preview = migration.previewLegacyMigration(storage, { targetDisplayName: selectedChild.displayName });
    const rows = compare(preview.balances, cloudBalance);
    return { ...preview, targetCloudChild: { id: selectedChild.id, displayName: selectedChild.displayName }, plannedLocalChildKey: "実行時に新規UUIDを生成", balanceComparison: rows, balanceMismatch: rows.some(row => row.difference !== null && row.difference !== 0) };
  }

  return Object.freeze({ V1_KEY, V2_KEY, MAPPING_KEY, MAPPING_V2_KEY, BALANCE_ROWS, compare, inspect, previewLegacy });
});
