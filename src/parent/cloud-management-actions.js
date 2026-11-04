(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports && typeof require === "function";
  const api = factory(
    commonJs ? require("../backup-core.js") : root.HapichikeBackup,
    commonJs ? require("../cloud-mapping-core.js") : root.HapichikeCloudMapping,
    commonJs ? require("../child-identity-core.js") : root.HapichikeChildIdentity,
    commonJs ? require("../profile-domain.js") : root.HapichikeProfileDomain,
    commonJs ? require("../profile-migration.js") : root.HapichikeProfileMigration,
    commonJs ? require("../initial-import-core.js") : root.HapichikeInitialImport,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeParentCloudActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (backup, mapping, identity, domain, migration, importCore) {
  "use strict";

  if (![backup, mapping, identity, domain, migration, importCore].every(Boolean)) throw new Error("Parent Cloud action dependencies are required");

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
    const legacyRaw = storage.getItem(mapping.MAIN_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = mapping.parseLocalState(legacyRaw);
      profiles.push({ localChildKey: mapping.LOCAL_CHILD_KEY, displayName: legacy.name, kind: "legacy", balances: { ...legacy.balances } });
    }
    const v2Raw = storage.getItem("kidsVegasCasino.v2");
    if (v2Raw) {
      const store = identity.parseStore(v2Raw);
      Object.values(store.profiles).forEach(profile => profiles.push({
        localChildKey: profile.localChildKey,
        displayName: profile.childName || "名前未設定",
        kind: "v2",
        balances: toCloudBalances(domain.getBalances(profile)),
        active: profile.localChildKey === store.activeLocalChildKey,
      }));
    }
    return profiles;
  }

  function requireProfile(storage, localChildKey) {
    const profile = readLocalProfiles(storage).find(item => item.localChildKey === localChildKey);
    if (!profile) throw new Error("LOCAL_INVALID");
    return profile;
  }

  function createBackup(storage, localChildKey, createdAt = new Date().toISOString()) {
    const profile = requireProfile(storage, localChildKey);
    const envelope = backup.createBackup(storage, createdAt);
    const metadata = importCore.recordBackupMetadata(storage, envelope.createdAt, profile.balances);
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
    if (!metadata || !importCore.isBackupCurrent(metadata, legacy.balances)) throw new Error("BACKUP_REQUIRED");
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
    if (!metadata || !importCore.isBackupCurrent(metadata, profile.balances)) throw new Error("BACKUP_REQUIRED");
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
    const preview = pending && await importCore.matchesPreview(pending, previewInput, options)
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
    const codes = ["AUTH_REQUIRED", "HOUSEHOLD_LOAD_FAILED", "CHILD_LOAD_FAILED", "LOCAL_INVALID", "BACKUP_REQUIRED", "MAPPING_REQUIRED", "MAPPING_CONFLICT", "CLOUD_INITIALIZED", "IMPORT_NOT_ALLOWED", "MIGRATION_CONFLICT", "NETWORK_ERROR"];
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
    readLocalProfiles, requireProfile, createBackup, applyMigration,
    createMappingPreview, saveMapping, createImportPreview, canExecuteImport, safeError, isRetryableNetworkError,
  });
});
