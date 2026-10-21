import { requireSupabase, unwrap } from "./apiClient.js";

export const getChildren = (householdId) => unwrap(requireSupabase().from("children").select("*").eq("household_id", householdId).order("display_order"));
export const getChildrenByHousehold = getChildren;
export const createChild = (child) => unwrap(requireSupabase().from("children").insert(child).select().single());
export const updateChild = (childId, patch) => unwrap(requireSupabase().from("children").update(patch).eq("id", childId).select().single());

// TODO: Read the selected child from a future authenticated household profile.
export const getSelectedChild = async () => null;
