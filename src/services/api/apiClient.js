import { supabase } from "../../lib/supabaseClient.js";

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. The app remains in localStorage-only mode.");
  }
  return supabase;
}

export async function unwrap(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
