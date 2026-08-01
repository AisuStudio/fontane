"use client";

import { createBrowserClient } from "@supabase/ssr";

// The client-side counterpart to src/lib/supabaseServer.ts — used for the
// actual auth actions a user performs in their own browser (sign in, sign
// out, watching session changes). Uses the anon key, not the service-role
// one src/lib/supabase.ts holds: this client is bound by RLS like any other
// authenticated user, which is the whole point (see
// supabase/fontane_projects_accounts.sql). Cookie storage is handled
// automatically by @supabase/ssr — proxy.ts is what keeps those cookies
// fresh across page loads.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
