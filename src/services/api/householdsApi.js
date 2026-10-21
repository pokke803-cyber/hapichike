import { requireSupabase, unwrap } from "./apiClient.js";

export const getHouseholds = () => unwrap(
  requireSupabase()
    .from("households")
    .select("*, household_members(id, user_id, role, created_at)")
    .order("created_at"),
);

// Start from the authenticated parent's membership rows. RLS remains the
// authorization boundary and limits both the memberships and joined households.
export const getCurrentHouseholds = async (userId) => {
  const memberships = await unwrap(
    requireSupabase()
      .from("household_members")
      .select("role, created_at, households!inner(*)")
      .eq("user_id", userId)
      .order("created_at"),
  );
  return memberships.map(({ households, role, created_at: membershipCreatedAt }) => ({
    ...households,
    membership_role: role,
    membership_created_at: membershipCreatedAt,
  }));
};

export const createHousehold = (name) => unwrap(
  requireSupabase().rpc("create_household", { household_name: name }),
);

export const updateHousehold = (householdId, patch) => unwrap(
  requireSupabase()
    .from("households")
    .update(patch)
    .eq("id", householdId)
    .select()
    .single(),
);

export const getHouseholdMembers = (householdId) => unwrap(
  requireSupabase()
    .from("household_members")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at"),
);
