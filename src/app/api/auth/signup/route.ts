import { createClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// Account creation only — logging back in and signing out go straight
// through the browser Supabase client (src/lib/supabaseBrowser.ts), no
// route needed for those. Sign-up is the one action that needs a server
// round-trip: the invite code has to be checked here, never client-side, so
// its real value (FONTANE_BETA_CODE) never reaches the browser bundle —
// same reasoning the old shared cloud-save betacode followed.
export async function POST(request: Request) {
  let body: { email?: string; password?: string; inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";

  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  const expected = process.env.FONTANE_BETA_CODE;
  if (!expected || inviteCode !== expected) {
    // trackGate("invite-code") fires client-side instead of here — src/lib/
    // analytics.ts's send() is a browser-only no-op on the server (it reads
    // `window`/sendBeacon), same reason every other API route in this repo
    // leaves tracking to the caller.
    return Response.json({ error: "Invalid invite code." }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  // If email confirmation is on for this Supabase project, signUp()
  // succeeds but returns no session — the account exists, but isn't logged
  // in yet. The client needs to know which case it's in.
  return Response.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    needsConfirmation: data.session === null,
  });
}
