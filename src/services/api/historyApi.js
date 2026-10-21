import { requireSupabase, unwrap } from "./apiClient.js";

export const getRewardLogs = (childId) => unwrap(requireSupabase().from("reward_logs").select("*").eq("child_id", childId).order("created_at", { ascending: false }));
export const getHouseholdRewardLogs = (householdId) => unwrap(requireSupabase().from("reward_logs").select("*").eq("household_id", householdId).order("created_at", { ascending: false }));

export const getRecentRewardLogs = (childId, limit = 10) => unwrap(
  requireSupabase()
    .from("reward_logs")
    .select("*")
    .eq("child_id", childId)
    .order("created_at", { ascending: false })
    .limit(limit),
);
