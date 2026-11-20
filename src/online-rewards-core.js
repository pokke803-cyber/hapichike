(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeOnlineRewardsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const APP_ID = "hapichike";
  const EVENT_STORAGE_KEY = "kidsVegasCasino.rewardSync.v1";
  const EVENT_VERSION = 1;
  const PAY_CATEGORIES = new Set(["sweets", "toy", "game"]);
  const ACTION_TYPES = new Set(["ticket", "star_coin", "star_exchange", "pay", "happy_chance"]);
  const locks = new Set();

  function isUuidV4(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  }
  function createEventId(cryptoApi = globalThis.crypto) {
    if (!cryptoApi || typeof cryptoApi.randomUUID !== "function") throw new Error("crypto.randomUUID is required");
    const value = cryptoApi.randomUUID();
    if (!isUuidV4(value)) throw new Error("eventId must be a UUID v4");
    return value;
  }
  function createRewardEvent(input = {}, dependencies = {}) {
    const actionType = input.actionType || input.type;
    if (!ACTION_TYPES.has(actionType)) throw new Error("invalid reward action type");
    for (const key of ["localChildKey", "supabaseChildId", "householdId"]) {
      if (typeof input[key] !== "string" || !input[key]) throw new Error(`${key} is required`);
    }
    if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error("amount must be a non-zero integer");
    if (actionType === "pay" && !PAY_CATEGORIES.has(input.payType || input.category)) throw new Error("invalid PAY category");
    const now = dependencies.now || (() => new Date());
    const eventId = input.eventId || createEventId(dependencies.cryptoApi);
    if (!isUuidV4(eventId)) throw new Error("eventId must be a UUID v4");
    return {
      eventId, localChildKey: input.localChildKey, supabaseChildId: input.supabaseChildId,
      householdId: input.householdId, actionType, amount: input.amount,
      payType: actionType === "pay" ? (input.payType || input.category) : null,
      source: typeof input.source === "string" && input.source ? input.source : "hapichike_ui",
      operationKey: typeof input.operationKey === "string" && input.operationKey ? input.operationKey : actionType,
      createdAt: now().toISOString(), status: "cloud_pending",
    };
  }
  function emptyEventDocument() { return { version: EVENT_VERSION, events: [] }; }
  function validateEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("invalid reward event");
    if (!isUuidV4(event.eventId)) throw new Error("invalid reward eventId");
    for (const key of ["localChildKey", "supabaseChildId", "householdId", "actionType", "operationKey", "createdAt", "status"]) {
      if (typeof event[key] !== "string" || !event[key]) throw new Error(`invalid reward event ${key}`);
    }
    if (!ACTION_TYPES.has(event.actionType) || !Number.isInteger(event.amount) || event.amount === 0) throw new Error("invalid reward event mutation");
    if (event.actionType === "pay" && !PAY_CATEGORIES.has(event.payType)) throw new Error("invalid reward event PAY type");
    if (!Number.isFinite(Date.parse(event.createdAt))) throw new Error("invalid reward event createdAt");
    if (!["cloud_pending", "local_pending"].includes(event.status)) throw new Error("invalid reward event status");
    return event;
  }
  function parseEventDocument(raw) {
    if (raw === null || raw === undefined || raw === "") return emptyEventDocument();
    let document;
    try { document = JSON.parse(raw); } catch { throw new Error("reward event state is invalid"); }
    if (!document || document.version !== EVENT_VERSION || !Array.isArray(document.events)) throw new Error("reward event state is invalid");
    const ids = new Set();
    document.events.forEach(event => { validateEvent(event); if (ids.has(event.eventId)) throw new Error("duplicate reward eventId"); ids.add(event.eventId); });
    return { version: EVENT_VERSION, events: document.events.map(event => ({ ...event })) };
  }
  function sameMutation(event, input) {
    return event.localChildKey === input.localChildKey && event.supabaseChildId === input.supabaseChildId
      && event.householdId === input.householdId && event.actionType === (input.actionType || input.type)
      && event.amount === input.amount && (event.payType || null) === (input.payType || input.category || null);
  }
  function findRetryEvent(document, operationKey, input) {
    const event = document.events.find(item => item.operationKey === operationKey) || null;
    if (!event) return null;
    if (!sameMutation(event, input)) throw new Error("STALE_PENDING_EVENT");
    return { ...event };
  }
  function upsertEvent(document, event) {
    validateEvent(event);
    return { version: EVENT_VERSION, events: [...document.events.filter(item => item.eventId !== event.eventId && item.operationKey !== event.operationKey), { ...event }] };
  }
  function removeEvent(document, eventId) { return { version: EVENT_VERSION, events: document.events.filter(item => item.eventId !== eventId) }; }
  function assertRpcResultChild(value, expectedChildId) {
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || row.child_id !== expectedChildId) throw new Error("RPC_CHILD_MISMATCH");
    return row;
  }
  async function withActionLock(key, action) {
    if (locks.has(key)) return { duplicate: true };
    locks.add(key);
    try { return await action(); } finally { locks.delete(key); }
  }
  return Object.freeze({ APP_ID, EVENT_STORAGE_KEY, EVENT_VERSION, PAY_CATEGORIES, isUuidV4, createEventId,
    createRewardEvent, emptyEventDocument, validateEvent, parseEventDocument, sameMutation, findRetryEvent,
    upsertEvent, removeEvent, assertRpcResultChild, withActionLock });
});
