import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side, session-aware Supabase client — distinct from
// src/lib/supabase.ts's getSupabase() (service-role, bypasses RLS, used by
// analytics/marketplace/provenance). This one reads the calling user's own
// session from cookies and runs every query as `authenticated`, so Postgres
// RLS (auth.uid() = user_id) is the actual security boundary for
// /api/projects/* and /api/auth/signup, not an app-level check.
//
// cookies() is async in this Next.js version — see AGENTS.md's warning that
// this isn't the Next.js you already know, confirmed against
// node_modules/next/dist/docs before writing this. setAll can throw when
// called from a Server Component (no response to attach cookies to); that's
// fine here since proxy.ts is what actually refreshes the session cookie on
// every request — this fallback only matters for Route Handlers, which CAN
// set cookies on their response.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component — no-op, proxy.ts covers refresh.
        }
      },
    },
  });
}
