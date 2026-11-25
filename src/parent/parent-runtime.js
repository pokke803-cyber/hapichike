(function (root, factory) {
  const core = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./parent-runtime-core.js")
    : root.HapichikeParentRuntimeCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeParentRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  const V1_KEY = "kidsVegasCasino.v1";
  const V2_KEY = "kidsVegasCasino.v2";
  const PARENT_SELECTION_KEY = "kidsVegasCasino.parentSelection.v1";

  function parseParentSelection(raw) {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || value.version !== 1
      || typeof value.userId !== "string" || !value.userId
      || typeof value.householdId !== "string" || !value.householdId
      || typeof value.cloudChildId !== "string" || !value.cloudChildId) {
      throw new Error("invalid parent selection");
    }
    return {
      version: 1,
      userId: value.userId,
      householdId: value.householdId,
      cloudChildId: value.cloudChildId,
    };
  }

  function createParentRuntime(dependencies) {
    if (!core) throw new Error("HapichikeParentRuntimeCore is required");
    const {
      authApi, householdsApi, childrenApi, rewardsApi, historyApi,
      storage = null, parsers = {}, queueTask = queueMicrotask,
      requestTimeoutMs = 15000, now = () => new Date(),
    } = dependencies;
    let state = core.createParentRuntimeState();
    let parentEmail = "";
    let authGeneration = 0;
    let childGeneration = 0;
    let detailGeneration = 0;
    let authSubscription = null;
    const listeners = new Set();

    function snapshot() {
      return JSON.parse(JSON.stringify(state));
    }

    function emit() {
      const next = snapshot();
      listeners.forEach(listener => listener(next));
    }

    function update(next) {
      state = next;
      emit();
      return state;
    }

    function invalidateCloudRequests() {
      childGeneration += 1;
      detailGeneration += 1;
    }

    function withTimeout(value) {
      if (!(requestTimeoutMs > 0)) return Promise.resolve(value);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("parent runtime read timeout")), requestTimeoutMs);
        Promise.resolve(value).then(
          result => { clearTimeout(timer); resolve(result); },
          error => { clearTimeout(timer); reject(error); },
        );
      });
    }

    function clearSelectionPreference() {
      try { storage?.removeItem(PARENT_SELECTION_KEY); }
      catch { /* Selection persistence must never weaken runtime authorization. */ }
    }

    function readSelectionPreference() {
      try { return parseParentSelection(storage?.getItem(PARENT_SELECTION_KEY) ?? null); }
      catch {
        clearSelectionPreference();
        return null;
      }
    }

    function saveSelectionPreference(childId) {
      if (state.auth.status !== "signed_in" || !state.auth.userId || !state.selectedHouseholdId) return;
      const child = state.cloudChildren.items.find(item => item.id === childId);
      if (!child || child.householdId !== state.selectedHouseholdId) return;
      try {
        storage?.setItem(PARENT_SELECTION_KEY, JSON.stringify({
          version: 1,
          userId: state.auth.userId,
          householdId: state.selectedHouseholdId,
          cloudChildId: child.id,
        }));
      } catch { /* The dashboard remains usable when storage is unavailable. */ }
    }

    function finalRuntimeStatus() {
      if (state.auth.status === "signed_out") return "signed_out";
      if (state.auth.status === "error" || state.households.status === "error" || state.cloudChildren.status === "error") return "error";
      if (state.households.status === "empty" || state.cloudChildren.status === "empty") return "empty";
      if (state.auth.status === "signed_in" && state.households.status === "ready"
        && (!state.selectedHouseholdId || state.cloudChildren.status === "ready")) return "success";
      return "error";
    }

    function finishInitialization(generation) {
      if (generation !== authGeneration || state.runtime.status !== "loading") return;
      const status = finalRuntimeStatus();
      update(core.applyRuntimeStatus(state, status));
    }

    function subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    async function readLocalIdentityState() {
      let legacyRaw = null;
      let v2Raw = null;
      let legacyError = false;
      let v2Error = false;
      try {
        legacyRaw = storage?.getItem(V1_KEY) ?? null;
      } catch {
        legacyError = true;
      }
      try {
        v2Raw = storage?.getItem(V2_KEY) ?? null;
      } catch {
        v2Error = true;
      }
      const localState = core.readLocalIdentityState({ legacyRaw, v2Raw, legacyError, v2Error }, parsers);
      update({
        ...core.applyLocalIdentityState(state, localState),
        local: { ...localState, readAt: now().toISOString() },
      });
      return localState;
    }

    async function refreshCloudChildren() {
      if (!state.selectedHouseholdId) return snapshot();
      const generation = ++childGeneration;
      detailGeneration += 1;
      update(core.startCloudChildrenLoad(state));
      try {
        const children = await withTimeout(childrenApi.getChildrenByHousehold(state.selectedHouseholdId));
        if (generation !== childGeneration) return snapshot();
        const sorted = [...(children ?? [])].sort((a, b) =>
          (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
        update(core.applyCloudChildrenLoaded(state, sorted));
        const preference = readSelectionPreference();
        if (preference?.userId === state.auth.userId
          && preference.householdId === state.selectedHouseholdId
          && !state.cloudChildren.items.some(child => child.id === preference.cloudChildId)) {
          clearSelectionPreference();
        }
      } catch {
        if (generation !== childGeneration) return snapshot();
        update(core.applyCloudChildrenError(state));
      }
      return snapshot();
    }

    async function loadHouseholds(userId, generation) {
      update(core.startHouseholdLoad(state));
      try {
        const households = await withTimeout(householdsApi.getCurrentHouseholds(userId));
        if (generation !== authGeneration) return;
        update(core.applyHouseholdsLoaded(state, households ?? []));
        if (state.selectedHouseholdId) await refreshCloudChildren();
      } catch {
        if (generation !== authGeneration) return;
        update(core.applyHouseholdError(state));
      }
    }

    async function restoreSelectionPreference(userId, generation) {
      const preference = readSelectionPreference();
      if (!preference) return;
      if (preference.userId !== userId) {
        clearSelectionPreference();
        return;
      }
      const household = state.households.items.find(item => item.id === preference.householdId);
      if (!household) {
        clearSelectionPreference();
        return;
      }
      if (generation !== authGeneration) return;
      if (state.selectedHouseholdId !== household.id) {
        update(core.selectHousehold(state, household.id));
        await refreshCloudChildren();
      }
      if (generation !== authGeneration) return;
      const child = state.cloudChildren.items.find(item =>
        item.id === preference.cloudChildId && item.householdId === household.id);
      if (!child) {
        clearSelectionPreference();
        return;
      }
      update(core.selectViewedCloudChild(state, child.id));
      await refreshViewedChildData();
    }

    async function applySession(session, generation = ++authGeneration) {
      invalidateCloudRequests();
      if (state.runtime.status !== "loading") update(core.applyRuntimeStatus(state, "loading"));
      try {
        const user = session?.user ?? null;
        parentEmail = typeof user?.email === "string" ? user.email : "";
        if (!user?.id) {
          update(core.applySignedOut(state));
          await readLocalIdentityState();
          return snapshot();
        }
        update(core.applySignedIn(state, user.id));
        await loadHouseholds(user.id, generation);
        if (generation === authGeneration && state.households.status === "ready") {
          await restoreSelectionPreference(user.id, generation);
        }
        if (generation === authGeneration) await readLocalIdentityState();
        return snapshot();
      } catch {
        if (generation === authGeneration) {
          update(core.applyAuthError(state));
          await readLocalIdentityState();
        }
        return snapshot();
      } finally {
        finishInitialization(generation);
      }
    }

    function ensureAuthListener() {
      if (authSubscription || typeof authApi.onParentAuthStateChange !== "function") return;
      const result = authApi.onParentAuthStateChange((_event, session) => {
        queueTask(() => { void applySession(session).catch(() => {}); });
      });
      authSubscription = result?.data?.subscription ?? result?.subscription ?? result ?? null;
    }

    async function initializeParentRuntime() {
      ensureAuthListener();
      const generation = ++authGeneration;
      invalidateCloudRequests();
      state = core.createParentRuntimeState();
      parentEmail = "";
      emit();
      try {
        const result = await withTimeout(authApi.getParentSession());
        if (generation !== authGeneration) return snapshot();
        return await applySession(result?.session ?? null, generation);
      } catch {
        if (generation !== authGeneration) return snapshot();
        update(core.applyAuthError(state));
        await readLocalIdentityState();
        return snapshot();
      } finally {
        finishInitialization(generation);
      }
    }

    async function selectHousehold(id) {
      invalidateCloudRequests();
      update(core.selectHousehold(state, id));
      clearSelectionPreference();
      return refreshCloudChildren();
    }

    async function selectViewedCloudChild(id) {
      detailGeneration += 1;
      update(core.selectViewedCloudChild(state, id));
      saveSelectionPreference(id);
      return refreshViewedChildData();
    }

    function resetViewedChild() {
      detailGeneration += 1;
      update(core.resetViewedChild(state));
      return snapshot();
    }

    async function refreshViewedChildData() {
      const childId = state.parentViewedSupabaseChildId;
      if (!childId) return snapshot();
      const generation = ++detailGeneration;
      update(core.startViewedChildDataLoad(state));
      try {
        const [balance, logs, syncState] = await withTimeout(Promise.all([
          rewardsApi.getChildBalances(childId),
          historyApi.getRecentRewardLogs(childId, 20),
          typeof rewardsApi.getChildAppSyncState === "function" ? rewardsApi.getChildAppSyncState(childId) : Promise.resolve(null),
        ]));
        if (generation !== detailGeneration || childId !== state.parentViewedSupabaseChildId) return snapshot();
        const next = core.applyViewedChildData(state, childId, balance, logs ?? [], syncState);
        update({ ...next, viewedChildData: { ...next.viewedChildData, fetchedAt: now().toISOString() } });
      } catch {
        if (generation !== detailGeneration || childId !== state.parentViewedSupabaseChildId) return snapshot();
        update(core.applyViewedChildDataError(state));
      }
      return snapshot();
    }

    function destroy() {
      listeners.clear();
      if (typeof authSubscription?.unsubscribe === "function") authSubscription.unsubscribe();
      authSubscription = null;
      invalidateCloudRequests();
      authGeneration += 1;
    }

    return Object.freeze({
      initializeParentRuntime,
      selectHousehold,
      selectViewedCloudChild,
      refreshCloudChildren,
      refreshViewedChildData,
      readLocalIdentityState,
      resetViewedChild,
      subscribe,
      getState: snapshot,
      getParentEmail: () => parentEmail,
      destroy,
    });
  }

  return Object.freeze({ V1_KEY, V2_KEY, PARENT_SELECTION_KEY, parseParentSelection, createParentRuntime });
});
