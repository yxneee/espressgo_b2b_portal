/* ============================================================
   supabase-config.js — ESPRESSGO Supabase Client
   ============================================================ */

const SUPABASE_URL = "https://aynwtgkmrymnrhzashtf.supabase.co";
const SUPABASE_KEY = "sb_publishable_stk65gIeVJPmtvdRM4tKDQ_FRIyop5P";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

window.sb = sb;
window.supabaseClient = sb;

console.log("ESPRESSGO Supabase client loaded:", sb);
