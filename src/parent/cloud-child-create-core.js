(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HapichikeCloudChildCreate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_ROLES = Object.freeze(["owner", "parent"]);
  const MAX_NAME_LENGTH = 12;

  class CloudChildCreateError extends Error {
    constructor(code) {
      super(code);
      this.name = "CloudChildCreateError";
      this.code = code;
    }
  }

  function normalizeDraft(draft = {}) {
    const name = typeof draft.name === "string" ? draft.name.trim() : "";
    const nickname = typeof draft.nickname === "string" ? draft.nickname.trim() : "";
    if (!name) throw new CloudChildCreateError("NAME_REQUIRED");
    if (name.length > MAX_NAME_LENGTH) throw new CloudChildCreateError("NAME_TOO_LONG");
    return { name, nickname };
  }

  function createPreview({ draft, household }) {
    if (!household?.id) throw new CloudChildCreateError("HOUSEHOLD_REQUIRED");
    const normalized = normalizeDraft(draft);
    return Object.freeze({
      householdId: household.id,
      householdName: typeof household.name === "string" ? household.name : "",
      name: normalized.name,
      nickname: normalized.nickname,
    });
  }

  function verifyPreflight({ preview, session, selectedHouseholdId, households }) {
    if (!session?.user?.id) throw new CloudChildCreateError("AUTH_REQUIRED");
    if (!preview?.householdId || preview.householdId !== selectedHouseholdId) {
      throw new CloudChildCreateError("HOUSEHOLD_CHANGED");
    }
    const household = (households ?? []).find(item => item.id === preview.householdId);
    if (!household) throw new CloudChildCreateError("HOUSEHOLD_FORBIDDEN");
    const role = household.membership_role ?? household.membershipRole ?? null;
    if (!ALLOWED_ROLES.includes(role)) throw new CloudChildCreateError("ROLE_FORBIDDEN");
    return { userId: session.user.id, householdId: household.id, role };
  }

  function findNewMatchingChild(beforeIds, children, preview) {
    const known = new Set(beforeIds ?? []);
    return (children ?? []).find(child => !known.has(child.id)
      && child.household_id === preview.householdId
      && child.name === preview.name
      && (child.nickname ?? "") === preview.nickname) ?? null;
  }

  return Object.freeze({
    ALLOWED_ROLES,
    MAX_NAME_LENGTH,
    CloudChildCreateError,
    normalizeDraft,
    createPreview,
    verifyPreflight,
    findNewMatchingChild,
  });
});
