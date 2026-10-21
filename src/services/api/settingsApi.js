import { requireSupabase, unwrap } from "./apiClient.js";

const ALLOWED_PARENT_SETTINGS = new Set([
  "parent_email",
  "audio_enabled",
  "bgm_enabled",
  "sfx_enabled",
]);

function sanitizeParentSettings(patch) {
  return Object.fromEntries(
    Object.entries(patch).filter(([key]) => ALLOWED_PARENT_SETTINGS.has(key)),
  );
}

export const getParentSettings = (householdId) => unwrap(requireSupabase().from("parent_settings").select("*").eq("household_id", householdId).maybeSingle());
export const updateParentSettings = (householdId, patch) => unwrap(requireSupabase().from("parent_settings").upsert({ household_id: householdId, ...sanitizeParentSettings(patch) }, { onConflict: "household_id" }).select().single());
