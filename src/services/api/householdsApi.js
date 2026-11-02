import { requireSupabase, unwrap } from "./apiClient.js";

export const getHouseholds = () => unwrap(
  requireSupabase()
    .from("households")
    .select("*, household_members(id, user_id, role, created_at)")
    .order("created_at"),
);

export const getHouseholdMembershipsForUser = (userId) => unwrap(
  requireSupabase()
    .from("household_members")
    .select("household_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at"),
);

export const getHouseholdsByIds = (householdIds) => {
  const ids = [...new Set((householdIds ?? []).filter(Boolean))];
  if (!ids.length) return Promise.resolve([]);
  return unwrap(
    requireSupabase()
      .from("households")
      .select("id, name, created_at")
      .in("id", ids)
      .order("created_at"),
  );
};

// Start from the authenticated parent's membership rows. Keep membership and
// household SELECT failures distinct; RLS remains the authorization boundary.
export const getCurrentHouseholds = async (userId) => {
  const memberships = await getHouseholdMembershipsForUser(userId);
  const households = await getHouseholdsByIds(memberships.map(item => item.household_id));
  const membershipByHousehold = new Map(memberships.map(item => [item.household_id, item]));
  return households.map((household) => {
    const membership = membershipByHousehold.get(household.id);
    return {
      ...household,
      membership_role: membership?.role,
      membership_created_at: membership?.created_at,
    };
  });
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
