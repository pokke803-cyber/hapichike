import { getParentSession } from "./api/authApi.js";
import {
  getHouseholdMembershipsForUser,
  getHouseholdsByIds,
} from "./api/householdsApi.js";
import { getChildrenByHousehold } from "./api/childrenApi.js";

export class CloudChildCandidatesError extends Error {
  constructor(stage, cause) {
    super(`Cloud Child取得エラー (${stage})`, { cause });
    this.name = "CloudChildCandidatesError";
    this.stage = stage;
  }
}

function notRunResult(sessionState, userState) {
  return {
    session: null,
    user: null,
    memberships: [],
    households: [],
    householdId: null,
    children: [],
    sessionState,
    userState,
    membershipsState: "not-run",
    householdsState: "not-run",
    childrenState: "not-run",
  };
}

export async function loadCloudChildCandidates(options = {}) {
  const dependencies = {
    getSession: getParentSession,
    getMemberships: getHouseholdMembershipsForUser,
    getHouseholds: getHouseholdsByIds,
    getChildren: getChildrenByHousehold,
    ...options.dependencies,
  };

  let session = options.session;
  if (session === undefined) {
    try {
      ({ session } = await dependencies.getSession());
    } catch (error) {
      throw new CloudChildCandidatesError("session", error);
    }
  }
  if (!session) return notRunResult("absent", "absent");
  if (!session.user) return { ...notRunResult("present", "absent"), session };

  let memberships;
  try {
    memberships = await dependencies.getMemberships(session.user.id);
  } catch (error) {
    throw new CloudChildCandidatesError("household_members", error);
  }
  if (!memberships.length) {
    return {
      ...notRunResult("present", "present"),
      session,
      user: session.user,
      memberships,
      membershipsState: "empty",
    };
  }

  let households;
  try {
    households = await dependencies.getHouseholds(memberships.map(item => item.household_id));
  } catch (error) {
    throw new CloudChildCandidatesError("households", error);
  }
  const membershipByHousehold = new Map(memberships.map(item => [item.household_id, item]));
  households = households.map((household) => {
    const membership = membershipByHousehold.get(household.id);
    return {
      ...household,
      membership_role: membership?.role,
      membership_created_at: membership?.created_at,
    };
  });
  if (!households.length) {
    return {
      session,
      user: session.user,
      memberships,
      households,
      householdId: null,
      children: [],
      sessionState: "present",
      userState: "present",
      membershipsState: "success",
      householdsState: "empty",
      childrenState: "not-run",
    };
  }

  const householdId = households.some(item => item.id === options.householdId)
    ? options.householdId
    : households[0].id;
  let children;
  try {
    children = await dependencies.getChildren(householdId);
  } catch (error) {
    throw new CloudChildCandidatesError("children", error);
  }
  return {
    session,
    user: session.user,
    memberships,
    households,
    householdId,
    children,
    sessionState: "present",
    userState: "present",
    membershipsState: "success",
    householdsState: "success",
    childrenState: children.length ? "success" : "empty",
  };
}
