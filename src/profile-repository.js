(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./child-identity-core.js")
    : root.HapichikeChildIdentity;
  const domain = typeof module === "object" && module.exports
    ? require("./profile-domain.js")
    : root.HapichikeProfileDomain;
  const api = factory(core, domain);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeProfileRepository = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, domain) {
  "use strict";

  if (!core) throw new Error("HapichikeChildIdentity is required");
  if (!domain) throw new Error("HapichikeProfileDomain is required");

  function createRepository(storage, options = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new Error("a localStorage-compatible storage is required");
    }
    const now = options.now || (() => new Date());
    const nowIso = () => now().toISOString();

    function readStore() {
      const parsed = core.parseStore(storage.getItem(core.STORAGE_KEY));
      return parsed === null ? core.createEmptyStore(nowIso()) : core.clone(parsed);
    }

    function writeStore(nextStore) {
      core.validateStore(nextStore);
      const nextRaw = JSON.stringify(nextStore);
      const previousRaw = storage.getItem(core.STORAGE_KEY);
      try {
        storage.setItem(core.STORAGE_KEY, nextRaw);
        const readbackRaw = storage.getItem(core.STORAGE_KEY);
        if (readbackRaw !== nextRaw) throw new Error("profile store readback did not match the write");
        core.parseStore(readbackRaw);
        return core.clone(nextStore);
      } catch (error) {
        try {
          if (previousRaw === null) storage.removeItem(core.STORAGE_KEY);
          else storage.setItem(core.STORAGE_KEY, previousRaw);
        } catch {
          throw new Error(`profile store write and rollback failed: ${error.message}`);
        }
        throw new Error(`profile store write failed; previous data was restored: ${error.message}`);
      }
    }

    function mutate(mutator) {
      const current = readStore();
      const next = core.clone(current);
      const result = mutator(next);
      next.updatedAt = nowIso();
      writeStore(next);
      return core.clone(result);
    }

    function createProfile(input = {}) {
      return mutate(store => {
        const profile = core.createProfileData(
          { childName: typeof input.childName === "string" ? input.childName : "" },
          { cryptoApi: options.cryptoApi, now },
        );
        if (Object.prototype.hasOwnProperty.call(store.profiles, profile.localChildKey)) {
          throw new Error("a profile with this localChildKey already exists");
        }
        store.profiles[profile.localChildKey] = profile;
        return profile;
      });
    }

    function getProfile(localChildKey) {
      core.validateLocalChildKey(localChildKey);
      const profile = readStore().profiles[localChildKey];
      return profile ? core.clone(profile) : null;
    }

    function getAllProfiles() {
      return Object.values(readStore().profiles).map(core.clone);
    }

    function updateProfile(localChildKey, patch) {
      core.validateLocalChildKey(localChildKey);
      core.assertSafeValue(patch, "profile patch");
      if (!core.isPlainObject(patch)) throw new Error("profile patch must be an object");
      if (Object.prototype.hasOwnProperty.call(patch, "localChildKey")) throw new Error("localChildKey cannot be changed");
      if (Object.prototype.hasOwnProperty.call(patch, "createdAt")) throw new Error("createdAt cannot be changed");
      return mutate(store => {
        const current = store.profiles[localChildKey];
        if (!current) throw new Error("profile was not found");
        const next = {
          ...current,
          ...core.clone(patch),
          points: Object.prototype.hasOwnProperty.call(patch, "points")
            ? { ...current.points, ...core.clone(patch.points) }
            : current.points,
          localChildKey,
          createdAt: current.createdAt,
          updatedAt: nowIso(),
        };
        core.validateProfile(next, localChildKey);
        store.profiles[localChildKey] = next;
        return next;
      });
    }

    function setActiveLocalChild(localChildKey) {
      if (localChildKey !== null) core.validateLocalChildKey(localChildKey);
      return mutate(store => {
        if (localChildKey !== null && !Object.prototype.hasOwnProperty.call(store.profiles, localChildKey)) {
          throw new Error("activeLocalChildKey must reference an existing profile");
        }
        store.activeLocalChildKey = localChildKey;
        return localChildKey;
      });
    }

    function getActiveLocalChild() {
      const store = readStore();
      return store.activeLocalChildKey === null ? null : core.clone(store.profiles[store.activeLocalChildKey]);
    }

    function updateDomain(localChildKey, updater) {
      const current = getProfile(localChildKey);
      if (!current) throw new Error("profile was not found");
      const next = updater(current);
      const patch = core.clone(next);
      delete patch.localChildKey;
      delete patch.createdAt;
      delete patch.updatedAt;
      return updateProfile(localChildKey, patch);
    }

    function setBalances(localChildKey, balances) {
      return updateDomain(localChildKey, profile => domain.setBalances(profile, balances));
    }

    function updateChildTasks(localChildKey, patch) {
      return updateDomain(localChildKey, profile => domain.updateChildTasks(profile, patch));
    }

    function appendChildHistory(localChildKey, channel, entry, limit) {
      return updateDomain(localChildKey, profile => domain.appendChildHistory(profile, channel, entry, limit));
    }

    function updateProgress(localChildKey, patch) {
      return updateDomain(localChildKey, profile => domain.updateProgress(profile, patch));
    }

    function updateResetState(localChildKey, patch) {
      return updateDomain(localChildKey, profile => domain.updateResetState(profile, patch));
    }

    function getHouseholdShared() {
      return domain.getHouseholdShared(readStore());
    }

    function updateHouseholdShared(patch) {
      return mutate(store => {
        const next = domain.updateHouseholdShared(store, patch);
        store.householdShared = next.householdShared;
        return store.householdShared;
      });
    }

    function removeProfile() {
      throw new Error("profile removal is disabled in Phase 2.5A");
    }

    return Object.freeze({
      readStore,
      createProfile,
      getProfile,
      getAllProfiles,
      updateProfile,
      setActiveLocalChild,
      getActiveLocalChild,
      setBalances,
      updateChildTasks,
      appendChildHistory,
      updateProgress,
      updateResetState,
      getHouseholdShared,
      updateHouseholdShared,
      removeProfile,
    });
  }

  return { createRepository };
});
