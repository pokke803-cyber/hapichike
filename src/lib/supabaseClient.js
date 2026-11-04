import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const STAGING_PROJECT_REF = "dhmkpqrfaukfbuoaenhk";

if (!hasSupabaseConfig) {
  console.warn("[HAPICHIKE] Supabase is not configured; continuing in localStorage-only mode.");
}

let initializedClient = null;
if (hasSupabaseConfig) {
  try {
    initializedClient = createClient(supabaseUrl, supabaseAnonKey);
  } catch {
    console.warn("[HAPICHIKE] Supabase client initialization failed.");
  }
}

export const supabase = initializedClient;

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

export function getSupabaseRuntimeDiagnostics() {
  let stagingProject = false;
  try {
    stagingProject = new URL(supabaseUrl).hostname === `${STAGING_PROJECT_REF}.supabase.co`;
  } catch {
    stagingProject = false;
  }
  return Object.freeze({
    clientInitialized: Boolean(supabase),
    urlConfigured: Boolean(supabaseUrl),
    anonKeyConfigured: Boolean(supabaseAnonKey),
    stagingProject,
  });
}
