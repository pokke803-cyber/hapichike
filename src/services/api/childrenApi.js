import { requireSupabase, unwrap } from "./apiClient.js";

export const getChildren = (householdId) => unwrap(requireSupabase().from("children").select("id, household_id, name, nickname, display_order").eq("household_id", householdId).order("display_order"));
export const getChildrenByHousehold = getChildren;
export const createChild = (householdId, name, nickname = "") => {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedNickname = typeof nickname === "string" ? nickname.trim() : "";
  if (typeof householdId !== "string" || !householdId || !normalizedName || normalizedName.length > 12) {
    throw new Error("INVALID_CHILD_CREATE_INPUT");
  }
  return unwrap(
    requireSupabase()
      .from("children")
      .insert({ household_id: householdId, name: normalizedName, nickname: normalizedNickname })
      .select("id, household_id, name, nickname, display_order")
      .single(),
  );
};
export const updateChild = (childId, patch) => unwrap(requireSupabase().from("children").update(patch).eq("id", childId).select().single());

// TODO: Read the selected child from a future authenticated household profile.
export const getSelectedChild = async () => null;
