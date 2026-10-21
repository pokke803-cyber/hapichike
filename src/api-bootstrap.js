import { isSupabaseConfigured } from "./lib/supabaseClient.js";

// Deliberately no sync or migration: localStorage remains the source of truth in this phase.
window.hapichikeApi = Object.freeze({ isSupabaseConfigured });
