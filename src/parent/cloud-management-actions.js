(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports && typeof require === "function";
  const api = factory(
    commonJs ? require("../backup-core.js") : root.HapichikeBackup,
    commonJs ? require("../cloud-mapping-core.js") : root.HapichikeCloudMapping,
    commonJs ? require("../child-identity-core.js") : root.HapichikeChildIdentity,
    commonJs ? require("../profile-domain.js") : root.HapichikeProfileDomain,
    commonJs ? require("../profile-repository.js") : root.HapichikeProfileRepository,
    commonJs ? require("../profile-migration.js") : root.HapichikeProfileMigration,
    commonJs ? require("../initial-import-core.js") : root.HapichikeInitialImport,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeParentCloudActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (backup, mapping, identity, domain, repository, migration, importCore) {
  "use strict";

  if (![backup, mapping, identity, domain, repository, migration, importCore].every(Boolean)) throw new Error("Parent Cloud action dependencies are required");

  function toCloudBalances(balances) {
    return {
      tickets: balances.tickets,
      star_coins: balances.starCoins,
      sweets_pay: balances.sweetsPay,
      toy_pay: balances.toyPay,
      game_pay: balances.gamePay,
      happy_chance_cards: balances.happyChanceCards,
    };
  }

  function readLocalProfiles(storage) {
    const profiles = [];
    const v2Active = storage.getItem(backup.V2_ACTIVATION_KEY) === "active";
    const legacyRaw = storage.getItem(mapping.MAIN_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = mapping.parseLocalState(legacyRaw);
      profiles.push({ localChildKey: mapping.LOCAL_CHILD_KEY, displayName: legacy.name, kind: "legacy", balances: { ...legacy.balances } });
    }
    const v2Raw = storage.getItem("kidsVegasCasino.v2");
    if (v2Raw) {
      let store;
      try { store = identity.parseStore(v2Raw); }
      catch (error) {
        if (v2Active) throw error;
        return profiles;
      }
      Object.values(store.profiles).forEach(profile => profiles.push({
        localChildKey: profile.localChildKey,
        displayName: profile.childName || "名前未設定",
        kind: "v2",
        balances: toCloudBalances(domain.getBalances(profile)),
        active: profile.localChildKey === store.activeLocalChildKey,
        pendingCloudIdentity: profile.pendingCloudIdentity ? { ...profile.pendingCloudIdentity } : null,
      }));
    }
    return profiles;
  }

  function requireProfile(storage, localChildKey) {
    const profile = readLocalProfiles(storage).find(item => item.localChildKey === localChildKey);
    if (!profile) throw new Error("LOCAL_INVALID");
    return profile;
  }

  function requireCloudTarget(input) {
    const cloudChild = input?.cloudChild;
    const householdId = input?.householdId;
    if (!cloudChild?.id || !householdId || cloudChild.householdId !== householdId
      || !(input.visibleChildren ?? []).some(child => child.id === cloudChild.id && child.householdId === householdId)) {
      throw new Error("CHILD_LOAD_FAILED");
    }
    return cloudChild;
  }

  function requireActivatedStore(storage) {
    if (storage.getItem(backup.V2_ACTIVATION_KEY) !== "active") throw new Error("V2_NOT_ACTIVATED");
    let store;
    try { store = identity.parseStore(storage.getItem(identity.STORAGE_KEY)); }
    catch { throw new Error("LOCAL_INVALID"); }
    if (!store?.activeLocalChildKey || !store.profiles[store.activeLocalChildKey]) throw new Error("LOCAL_INVALID");
    return store;
  }

  function assertCloudProfileAvailable(storage, store, cloudChild, householdId) {
    const pendingConflict = Object.values(store.profiles).find(profile => profile.pendingCloudIdentity?.supabaseChildId === cloudChild.id);
    let mappingDocument;
    try { mappingDocument = mapping.parseV2MappingDocument(storage.getItem(mapping.MAPPING_V2_STORAGE_KEY)); }
    catch { throw new Error("MAPPING_CONFLICT"); }
    const mappedConflict = mappingDocument.mappings.find(item => item.supabaseChildId === cloudChild.id);
    if (pendingConflict || mappedConflict) throw new Error("LOCAL_PROFILE_DUPLICATE");
    if (mappingDocument.mappings.some(item => item.householdId !== householdId && item.supabaseChildId === cloudChild.id)) {
      throw new Error("MAPPING_CONFLICT");
    }
  }

  function previewLocalProfileCreation(storage, input) {
    const cloudChild = requireCloudTarget(input);
    const store = requireActivatedStore(storage);
    assertCloudProfileAvailable(storage, store, cloudChild, input.householdId);
    return {
      cloudChildId: cloudChild.id,
      childName: cloudChild.displayName || "名前未設定",
      householdId: input.householdId,
      sourceStoreRaw: storage.getItem(identity.STORAGE_KEY),
      activeLocalChildKey: store.activeLocalChildKey,
      balances: { tickets: 0, starCoins: 0, sweetsPay: 0, toyPay: 0, gamePay: 0, happyChanceCards: 0 },
      taskAssignments: 0,
      historyEntries: 0,
      progress: "default",
      resetState: "default",
      cloudWrite: false,
    };
  }

  function createLocalProfile(storage, preview, input, options = {}) {
    if (input?.parentApproved !== true) throw new Error("PROFILE_CREATION_CONFLICT");
    const cloudChild = requireCloudTarget(input);
    const store = requireActivatedStore(storage);
    if (!preview || preview.cloudChildId !== cloudChild.id || preview.householdId !== input.householdId
      || preview.childName !== (cloudChild.displayName || "名前未設定")
      || preview.sourceStoreRaw !== storage.getItem(identity.STORAGE_KEY)) {
      throw new Error("PROFILE_CREATION_CONFLICT");
    }
    assertCloudProfileAvailable(storage, store, cloudChild, input.householdId);
    const now = options.now || (() => new Date());
    const preparedAt = now().toISOString();
    const repo = repository.createRepository(storage, { now: () => new Date(preparedAt), cryptoApi: options.cryptoApi });
    const profile = repo.createProfile({
      childName: preview.childName,
      pendingCloudIdentity: { supabaseChildId: cloudChild.id, householdId: input.householdId, preparedAt },
    });
    const after = requireActivatedStore(storage);
    if (after.activeLocalChildKey !== store.activeLocalChildKey) throw new Error("PROFILE_CREATION_CONFLICT");
    return { profile, activeLocalChildKey: after.activeLocalChildKey };
  }

  function compareProfileToCloud(storage, localChildKey, cloudBalance) {
    const profile = requireProfile(storage, localChildKey);
    return mapping.compareBalances({ balances: profile.balances }, cloudBalance);
  }

  function resolveBackupSource(storage, localChildKey) {
    if (storage.getItem(backup.V2_ACTIVATION_KEY) !== "active") {
      if (localChildKey && localChildKey !== mapping.LOCAL_CHILD_KEY) throw new Error("LOCAL_INVALID");
      return requireProfile(storage, mapping.LOCAL_CHILD_KEY);
    }
    let store;
    try { store = identity.parseStore(storage.getItem(identity.STORAGE_KEY)); }
    catch { throw new Error("LOCAL_INVALID"); }
    const targetKey = localChildKey || store?.activeLocalChildKey;
    if (!targetKey || !store.profiles[targetKey]) throw new Error("LOCAL_INVALID");
    const profile = readLocalProfiles(storage).find(item => item.kind === "v2" && item.localChildKey === targetKey);
    if (!profile) throw new Error("LOCAL_INVALID");
    return profile;
  }

  function createBackup(storage, localChildKey, createdAt = new Date().toISOString()) {
    const profile = resolveBackupSource(storage, localChildKey);
    const mode = profile.kind === "v2" ? "v2" : "legacy";
    const envelope = backup.createBackup(storage, createdAt, { mode });
    const metadata = importCore.recordBackupMetadata(storage, envelope.createdAt, profile.balances, profile.localChildKey);
    return { envelope, metadata, profile };
  }

  function applyMigration(storage, input, options = {}) {
    if (input?.parentApproved !== true || input?.backupApproved !== true || input?.previewApproved !== true || input?.cloudWriteZeroApproved !== true) {
      throw new Error("MIGRATION_CONFLICT");
    }
    if (!input.targetChild || input.targetChild.householdId !== input.householdId
      || !(input.visibleChildren ?? []).some(child => child.id === input.targetChild.id && child.householdId === input.householdId)) {
      throw new Error("CHILD_LOAD_FAILED");
    }
    const legacy = requireProfile(storage, mapping.LOCAL_CHILD_KEY);
    const metadata = importCore.readBackupMetadata(storage);
    if (!metadata || !importCore.isBackupCurrent(metadata, legacy.balances, legacy.localChildKey)) throw new Error("BACKUP_REQUIRED");
    if (!input.preview?.canApply || input.preview.targetCloudChild?.id !== input.targetChild.id) throw new Error("MIGRATION_CONFLICT");
    return migration.applyLegacyMigration(storage, {
      targetDisplayName: input.targetChild.displayName,
      previewToken: input.preview.previewToken,
      legacyFieldScopes: input.legacyFieldScopes || {},
      ...options,
    });
  }

  function createMappingPreview(storage, input) {
    const profile = requireProfile(storage, input.localChildKey);
    if (profile.pendingCloudIdentity
      && (profile.pendingCloudIdentity.supabaseChildId !== input.cloudChild?.id
        || profile.pendingCloudIdentity.householdId !== input.householdId)) {
      throw new Error("MAPPING_CONFLICT");
    }
    return mapping.createV2MappingPreview({
      localProfile: { localChildKey: profile.localChildKey, displayName: profile.displayName },
      cloudChild: input.cloudChild,
      householdId: input.householdId,
      visibleChildren: input.visibleChildren,
      mappingRaw: storage.getItem(mapping.MAPPING_V2_STORAGE_KEY),
    });
  }

  function saveMapping(storage, preview, input, confirmedAt) {
    const profile = requireProfile(storage, preview?.localChildKey);
    if (profile.pendingCloudIdentity
      && (profile.pendingCloudIdentity.supabaseChildId !== input.cloudChild?.id
        || profile.pendingCloudIdentity.householdId !== input.householdId)) {
      throw new Error("MAPPING_CONFLICT");
    }
    return mapping.saveVerifiedV2Mapping(storage, preview, {
      parentApproved: input.parentApproved,
      localProfile: { localChildKey: profile.localChildKey, displayName: profile.displayName },
      cloudChild: input.cloudChild,
      householdId: input.householdId,
      visibleChildren: input.visibleChildren,
    }, confirmedAt);
  }

  async function createImportPreview(storage, input, options = {}) {
    const profile = requireProfile(storage, input.localChildKey);
    const metadata = importCore.readBackupMetadata(storage);
    if (!metadata || !importCore.isBackupCurrent(metadata, profile.balances, profile.localChildKey)) throw new Error("BACKUP_REQUIRED");
    if (input.readiness?.ready !== true) throw new Error(input.readiness?.cloudInitialized ? "CLOUD_INITIALIZED" : "IMPORT_NOT_ALLOWED");
    const previewInput = {
      childId: input.childId,
      balances: profile.balances,
      backupCreatedAt: metadata.backup_created_at,
      parentApproved: input.parentApproved === true,
      title: "初回データ移行",
      metadata: { source: profile.kind === "v2" ? "local_profile_v2" : "legacy_localstorage", local_child_key: profile.localChildKey },
    };
    const pending = importCore.readPendingPreview(storage);
    const preview = pending
      && pending.metadata?.local_child_key === profile.localChildKey
      && await importCore.matchesPreview(pending, previewInput, options)
      ? pending
      : await importCore.createInitialImportPreview(previewInput, options);
    if (preview !== pending) importCore.savePendingPreview(storage, preview);
    return preview;
  }

  function canExecuteImport(input) {
    return importCore.canExecuteImport(input.readiness, input.approvals, input.importing)
      && input.preview?.child_id === input.childId
      && input.mappingValid === true;
  }

  function safeError(error) {
    const message = String(error?.message || error || "").toUpperCase();
    const codes = ["AUTH_REQUIRED", "HOUSEHOLD_LOAD_FAILED", "CHILD_LOAD_FAILED", "LOCAL_PROFILE_DUPLICATE", "PROFILE_CREATION_CONFLICT", "V2_NOT_ACTIVATED", "LOCAL_INVALID", "BACKUP_REQUIRED", "MAPPING_REQUIRED", "MAPPING_CONFLICT", "MAPPING_STALE", "CLOUD_INITIALIZED", "IMPORT_NOT_ALLOWED", "MIGRATION_CONFLICT", "NETWORK_ERROR"];
    const explicit = codes.find(code => message.includes(code));
    if (explicit) return explicit;
    if (/BACKUP/.test(message)) return "BACKUP_REQUIRED";
    if (/ALREADY.*MIGRAT|DUPLICATE|PREVIEW TOKEN|SOURCE STATE CHANGED|CONFLICT|UNKNOWN LEGACY/.test(message)) return "MIGRATION_CONFLICT";
    if (/ALREADY INITIALIZED|ALREADY COMPLETE|ALREADY IMPORTED/.test(message)) return "CLOUD_INITIALIZED";
    if (/MAPPING/.test(message)) return "MAPPING_REQUIRED";
    if (/LOCAL|KIDSVEGASCASINO|PROFILE/.test(message)) return "LOCAL_INVALID";
    if (/AUTH|SESSION|JWT|PERMISSION|ROW-LEVEL/.test(message)) return "AUTH_REQUIRED";
    return "NETWORK_ERROR";
  }

  function isRetryableNetworkError(error) {
    return /FETCH|NETWORK|OFFLINE|TIMEOUT|CONNECTION/.test(String(error?.message || error || "").toUpperCase());
  }

  return Object.freeze({
    readLocalProfiles, requireProfile, previewLocalProfileCreation, createLocalProfile, compareProfileToCloud,
    resolveBackupSource, createBackup, applyMigration,
    createMappingPreview, saveMapping, createImportPreview, canExecuteImport, safeError, isRetryableNetworkError,
  });
});
