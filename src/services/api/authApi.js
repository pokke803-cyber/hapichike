import { requireSupabase, unwrap } from "./apiClient.js";

export const signUpParent = (email, password) => unwrap(
  requireSupabase().auth.signUp({ email, password }),
);

export const signInParent = (email, password) => unwrap(
  requireSupabase().auth.signInWithPassword({ email, password }),
);

export const requestParentPasswordReset = (email) => unwrap(
  requireSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: "https://hapichike-staging.vercel.app/parent/set-password",
  }),
);

export const signOutParent = () => unwrap(requireSupabase().auth.signOut());
export const getParentSession = () => unwrap(requireSupabase().auth.getSession());
export const getParentUser = () => unwrap(requireSupabase().auth.getUser());
export const updateParentPassword = (password) => unwrap(
  requireSupabase().auth.updateUser({ password }),
);

export function onParentAuthStateChange(callback) {
  return requireSupabase().auth.onAuthStateChange(callback);
}
