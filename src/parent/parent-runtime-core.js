(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeParentRuntimeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AUTH_STATUSES = Object.freeze(["loading", "signed_out", "signed_in", "error"]);
  const HOUSEHOLD_STATUSES = Object.freeze(["not_loaded", "loading", "ready", "empty", "error"]);
  const CLOUD_CHILD_STATUSES = Object.freeze(["not_loaded", "loading", "ready", "empty", "error"]);
  const LOCAL_STATUSES = Object.freeze(["loading", "success", "missing", "invalid", "error"]);
  const RUNTIME_STATUSES = Object.freeze(["loading", "success", "empty", "signed_out", "error"]);
  const ERROR_CODES = Object.freeze({
    AUTH_REQUIRED: "AUTH_REQUIRED",
    AUTH_LOAD_FAILED: "AUTH_LOAD_FAILED",
    HOUSEHOLD_NOT_FOUND: "HOUSEHOLD_NOT_FOUND",
    HOUSEHOLD_LOAD_FAILED: "HOUSEHOLD_LOAD_FAILED",
    CHILD_LOAD_FAILED: "CHILD_LOAD_FAILED",
    CHILD_SELECTION_INVALID: "CHILD_SELECTION_INVALID",
    LOCAL_V1_INVALID: "LOCAL_V1_INVALID",
    LOCAL_V2_INVALID: "LOCAL_V2_INVALID",
    MAPPING_REQUIRED: "MAPPING_REQUIRED",
    CONNECTION_FAILED: "CONNECTION_FAILED",
  });
  const RUNTIME_ACTIONS = Object.freeze([
    "initializeParentRuntime",
    "selectHousehold",
    "selectViewedCloudChild",
    "refreshCloudChildren",
    "refreshViewedChildData",
    "readLocalIdentityState",
    "resetViewedChild",
  ]);

  class ParentRuntimeContractError extends Error {
    constructor(code) {
      super(code);
      this.name = "ParentRuntimeContractError";
      this.code = code;
    }
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function createParentRuntimeState() {
    return {
      runtime: { status: "loading", errorCode: null },
      auth: { status: "loading", userId: null, errorCode: null },
      connection: { status: "idle", errorCode: null },
      households: { status: "not_loaded", items: [], errorCode: null },
      selectedHouseholdId: null,
      cloudChildren: { status: "not_loaded", items: [], errorCode: null },
      parentViewedSupabaseChildId: null,
      viewedChildData: { status: "not_loaded", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
      local: {
        legacyStatus: "loading",
        v2Status: "loading",
        activeLocalChildKey: null,
        activeLocalChildExists: false,
        profileCount: 0,
        errorCodes: [],
      },
    };
  }

  function applyRuntimeStatus(state, status, errorCode = null) {
    if (!RUNTIME_STATUSES.includes(status)) throw new ParentRuntimeContractError(ERROR_CODES.CONNECTION_FAILED);
    return { ...state, runtime: { status, errorCode: status === "error" ? (errorCode ?? ERROR_CODES.CONNECTION_FAILED) : null } };
  }

  function clearCloudScope(state) {
    return {
      ...state,
      cloudChildren: { status: "not_loaded", items: [], errorCode: null },
      parentViewedSupabaseChildId: null,
      viewedChildData: { status: "not_loaded", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
    };
  }

  function applySignedOut(state) {
    return {
      ...clearCloudScope(state),
      auth: { status: "signed_out", userId: null, errorCode: null },
      connection: { status: "idle", errorCode: null },
      households: { status: "not_loaded", items: [], errorCode: null },
      selectedHouseholdId: null,
    };
  }

  function applySignedIn(state, userId) {
    if (typeof userId !== "string" || !userId) throw new ParentRuntimeContractError(ERROR_CODES.AUTH_REQUIRED);
    return {
      ...clearCloudScope(state),
      auth: { status: "signed_in", userId, errorCode: null },
      connection: { status: "ready", errorCode: null },
      households: { status: "not_loaded", items: [], errorCode: null },
      selectedHouseholdId: null,
    };
  }

  function applyAuthError(state) {
    return {
      ...applySignedOut(state),
      auth: { status: "error", userId: null, errorCode: ERROR_CODES.AUTH_LOAD_FAILED },
      connection: { status: "error", errorCode: ERROR_CODES.CONNECTION_FAILED },
    };
  }

  function startHouseholdLoad(state) {
    if (state.auth.status !== "signed_in") throw new ParentRuntimeContractError(ERROR_CODES.AUTH_REQUIRED);
    return {
      ...clearCloudScope(state),
      households: { status: "loading", items: [], errorCode: null },
      selectedHouseholdId: null,
    };
  }

  function normalizeHousehold(item) {
    if (!item || typeof item.id !== "string" || !item.id) {
      throw new ParentRuntimeContractError(ERROR_CODES.HOUSEHOLD_LOAD_FAILED);
    }
    return {
      id: item.id,
      name: typeof item.name === "string" ? item.name : "",
      membershipRole: typeof item.membership_role === "string" ? item.membership_role : null,
    };
  }

  function applyHouseholdsLoaded(state, households) {
    const items = (households ?? []).map(normalizeHousehold);
    const selectedHouseholdId = items.length === 1 ? items[0].id : null;
    return {
      ...clearCloudScope(state),
      households: { status: items.length ? "ready" : "empty", items, errorCode: null },
      selectedHouseholdId,
    };
  }

  function applyHouseholdError(state) {
    return {
      ...clearCloudScope(state),
      households: { status: "error", items: [], errorCode: ERROR_CODES.HOUSEHOLD_LOAD_FAILED },
      selectedHouseholdId: null,
      connection: { status: "error", errorCode: ERROR_CODES.CONNECTION_FAILED },
    };
  }

  function selectHousehold(state, householdId) {
    if (!state.households.items.some(item => item.id === householdId)) {
      throw new ParentRuntimeContractError(ERROR_CODES.HOUSEHOLD_NOT_FOUND);
    }
    return { ...clearCloudScope(state), selectedHouseholdId: householdId };
  }

  function startCloudChildrenLoad(state) {
    if (state.auth.status !== "signed_in") throw new ParentRuntimeContractError(ERROR_CODES.AUTH_REQUIRED);
    if (!state.selectedHouseholdId) throw new ParentRuntimeContractError(ERROR_CODES.HOUSEHOLD_NOT_FOUND);
    return {
      ...state,
      cloudChildren: { status: "loading", items: [], errorCode: null },
      viewedChildData: { status: "not_loaded", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
    };
  }

  function toCloudChildReadModel(child) {
    if (!child || typeof child.id !== "string" || !child.id || typeof child.household_id !== "string") {
      throw new ParentRuntimeContractError(ERROR_CODES.CHILD_LOAD_FAILED);
    }
    return {
      id: child.id,
      householdId: child.household_id,
      displayName: typeof child.display_name === "string"
        ? child.display_name
        : (typeof child.name === "string" ? child.name : ""),
      displayOrder: Number.isFinite(child.display_order) ? child.display_order : 0,
    };
  }

  function applyCloudChildrenLoaded(state, children) {
    const items = (children ?? []).map(toCloudChildReadModel);
    if (items.some(child => child.householdId !== state.selectedHouseholdId)) {
      throw new ParentRuntimeContractError(ERROR_CODES.CHILD_SELECTION_INVALID);
    }
    const selectionStillValid = items.some(child => child.id === state.parentViewedSupabaseChildId);
    return {
      ...state,
      cloudChildren: { status: items.length ? "ready" : "empty", items, errorCode: null },
      parentViewedSupabaseChildId: selectionStillValid ? state.parentViewedSupabaseChildId : null,
      viewedChildData: selectionStillValid ? state.viewedChildData : { status: "not_loaded", errorCode: null },
      viewedChildBalance: selectionStillValid ? state.viewedChildBalance : null,
      viewedChildRewardLogs: selectionStillValid ? state.viewedChildRewardLogs : [],
      viewedChildSyncState: selectionStillValid ? state.viewedChildSyncState : null,
      connection: { status: "ready", errorCode: null },
    };
  }

  function applyCloudChildrenError(state) {
    return {
      ...clearCloudScope(state),
      cloudChildren: { status: "error", items: [], errorCode: ERROR_CODES.CHILD_LOAD_FAILED },
      connection: { status: "error", errorCode: ERROR_CODES.CONNECTION_FAILED },
    };
  }

  function selectViewedCloudChild(state, childId) {
    if (!state.cloudChildren.items.some(child => child.id === childId)) {
      throw new ParentRuntimeContractError(ERROR_CODES.CHILD_SELECTION_INVALID);
    }
    return {
      ...state,
      parentViewedSupabaseChildId: childId,
      viewedChildData: { status: "not_loaded", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
    };
  }

  function resetViewedChild(state) {
    return {
      ...state,
      parentViewedSupabaseChildId: null,
      viewedChildData: { status: "not_loaded", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
    };
  }

  function startViewedChildDataLoad(state) {
    if (!state.parentViewedSupabaseChildId) {
      throw new ParentRuntimeContractError(ERROR_CODES.CHILD_SELECTION_INVALID);
    }
    return {
      ...state,
      viewedChildData: { status: "loading", errorCode: null },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
    };
  }

  function applyViewedChildData(state, childId, balance, rewardLogs, syncState = null) {
    if (childId !== state.parentViewedSupabaseChildId) {
      throw new ParentRuntimeContractError(ERROR_CODES.CHILD_SELECTION_INVALID);
    }
    return {
      ...state,
      viewedChildData: { status: "ready", errorCode: null },
      viewedChildBalance: balance === null ? null : clone(balance),
      viewedChildRewardLogs: clone(rewardLogs ?? []),
      viewedChildSyncState: syncState === null ? null : clone(syncState),
      connection: { status: "ready", errorCode: null },
    };
  }

  function applyViewedChildDataError(state) {
    return {
      ...state,
      viewedChildData: { status: "error", errorCode: ERROR_CODES.CHILD_LOAD_FAILED },
      viewedChildBalance: null,
      viewedChildRewardLogs: [],
      viewedChildSyncState: null,
      connection: { status: "error", errorCode: ERROR_CODES.CONNECTION_FAILED },
    };
  }

  function defaultParseLegacy(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid legacy state");
    return parsed;
  }

  function defaultParseV2(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 2 || parsed.appId !== "hapichike" || !parsed.profiles || typeof parsed.profiles !== "object") {
      throw new Error("invalid v2 state");
    }
    if (parsed.activeLocalChildKey !== null && typeof parsed.activeLocalChildKey !== "string") {
      throw new Error("invalid activeLocalChildKey");
    }
    return parsed;
  }

  function readLocalIdentityState(rawState = {}, parsers = {}) {
    const result = {
      legacyStatus: "missing",
      v2Status: "missing",
      activeLocalChildKey: null,
      activeLocalChildExists: false,
      profileCount: 0,
      errorCodes: [],
    };
    if (rawState.legacyError) result.legacyStatus = "error";
    if (rawState.v2Error) result.v2Status = "error";
    if (!rawState.legacyError && rawState.legacyRaw !== null && rawState.legacyRaw !== undefined && rawState.legacyRaw !== "") {
      try {
        (parsers.parseLegacy || defaultParseLegacy)(rawState.legacyRaw);
        result.legacyStatus = "success";
      } catch {
        result.legacyStatus = "invalid";
        result.errorCodes.push(ERROR_CODES.LOCAL_V1_INVALID);
      }
    }
    if (!rawState.v2Error && rawState.v2Raw !== null && rawState.v2Raw !== undefined && rawState.v2Raw !== "") {
      try {
        const store = (parsers.parseV2 || defaultParseV2)(rawState.v2Raw);
        result.v2Status = "success";
        result.profileCount = Object.keys(store.profiles).length;
        result.activeLocalChildKey = store.activeLocalChildKey ?? null;
        result.activeLocalChildExists = result.activeLocalChildKey !== null
          && Object.prototype.hasOwnProperty.call(store.profiles, result.activeLocalChildKey);
        if (result.activeLocalChildKey !== null && !result.activeLocalChildExists) {
          result.v2Status = "invalid";
          result.activeLocalChildKey = null;
          result.errorCodes.push(ERROR_CODES.LOCAL_V2_INVALID);
        }
      } catch {
        result.v2Status = "invalid";
        result.activeLocalChildKey = null;
        result.activeLocalChildExists = false;
        result.profileCount = 0;
        result.errorCodes.push(ERROR_CODES.LOCAL_V2_INVALID);
      }
    }
    return result;
  }

  function applyLocalIdentityState(state, localState) {
    if (!LOCAL_STATUSES.includes(localState.legacyStatus) || !LOCAL_STATUSES.includes(localState.v2Status)) {
      throw new ParentRuntimeContractError(ERROR_CODES.LOCAL_V2_INVALID);
    }
    return { ...state, local: clone(localState) };
  }

  function getCloudWriteGate(state, context = {}) {
    const reasons = [];
    if (state.auth.status !== "signed_in") reasons.push(ERROR_CODES.AUTH_REQUIRED);
    if (state.connection.status === "error") reasons.push(ERROR_CODES.CONNECTION_FAILED);
    if (state.households.status !== "ready" || !state.selectedHouseholdId) reasons.push(ERROR_CODES.HOUSEHOLD_NOT_FOUND);
    if (state.cloudChildren.status !== "ready" || !state.parentViewedSupabaseChildId) reasons.push(ERROR_CODES.CHILD_SELECTION_INVALID);
    const selected = state.cloudChildren.items.find(child => child.id === state.parentViewedSupabaseChildId);
    if (!selected || selected.householdId !== state.selectedHouseholdId) reasons.push(ERROR_CODES.CHILD_SELECTION_INVALID);
    if (context.requiresMapping && context.mappingStatus !== "verified") reasons.push(ERROR_CODES.MAPPING_REQUIRED);
    if (context.requiresLocalIdentity && !context.localChildKey) reasons.push(ERROR_CODES.LOCAL_V2_INVALID);
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  function toParentRuntimeErrorCode(error, stage) {
    if (Object.values(ERROR_CODES).includes(error?.code)) return error.code;
    return ({
      auth: ERROR_CODES.AUTH_LOAD_FAILED,
      household: ERROR_CODES.HOUSEHOLD_LOAD_FAILED,
      children: ERROR_CODES.CHILD_LOAD_FAILED,
      connection: ERROR_CODES.CONNECTION_FAILED,
      local_v1: ERROR_CODES.LOCAL_V1_INVALID,
      local_v2: ERROR_CODES.LOCAL_V2_INVALID,
      mapping: ERROR_CODES.MAPPING_REQUIRED,
    })[stage] ?? ERROR_CODES.CONNECTION_FAILED;
  }

  return Object.freeze({
    AUTH_STATUSES,
    HOUSEHOLD_STATUSES,
    CLOUD_CHILD_STATUSES,
    LOCAL_STATUSES,
    ERROR_CODES,
    RUNTIME_ACTIONS,
    ParentRuntimeContractError,
    createParentRuntimeState,
    applyRuntimeStatus,
    applySignedOut,
    applySignedIn,
    applyAuthError,
    startHouseholdLoad,
    applyHouseholdsLoaded,
    applyHouseholdError,
    selectHousehold,
    startCloudChildrenLoad,
    toCloudChildReadModel,
    applyCloudChildrenLoaded,
    applyCloudChildrenError,
    selectViewedCloudChild,
    resetViewedChild,
    startViewedChildDataLoad,
    applyViewedChildData,
    applyViewedChildDataError,
    readLocalIdentityState,
    applyLocalIdentityState,
    getCloudWriteGate,
    toParentRuntimeErrorCode,
  });
});
