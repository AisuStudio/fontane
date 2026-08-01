import { createClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// List: just enough to render "My Cloud Projects" (name + when), never the
// full glyph/stroke data — that's only fetched per-project on Load, see
// api/projects/[id]/route.ts. Scoped to the signed-in user by RLS (see
// supabase/fontane_projects_accounts.sql), not by a query filter here — the
// session-aware client from src/lib/supabaseServer.ts queries as
// `authenticated`, so a row belonging to someone else never comes back.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("fontane_projects")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    return Response.json({ error: "list failed" }, { status: 500 });
  }
  return Response.json({ projects: data });
}

// Save: `id` present = update that row's name/data in place ("Save"),
// absent = insert a new row ("Save As"). The client always sends the full
// ProjectFile (glyphs/strokes/metrics/settings) as `project` — same shape
// buildProjectFile() in src/lib/projectFile.ts produces for the local FFF
// download, just stored as jsonb instead of downloaded as a file.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { id?: number; name?: string; project?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "missing name" }, { status: 400 });
  }
  if (!body.project || typeof body.project !== "object") {
    return Response.json({ error: "missing project data" }, { status: 400 });
  }

  if (typeof body.id === "number") {
    // RLS's `using (auth.uid() = user_id)` is what actually stops this from
    // touching another user's row (matches zero rows, `.maybeSingle()`
    // returns null) — the id alone isn't ownership proof.
    const { data, error } = await supabase
      .from("fontane_projects")
      .update({ name, data: body.project, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .select("id, name, updated_at")
      .maybeSingle();
    if (error || !data) {
      return Response.json({ error: "update failed" }, { status: 500 });
    }
    return Response.json({ project: data });
  }

  // user_id is required by both the column's not-null constraint and the
  // insert policy's `with check (auth.uid() = user_id)` — set explicitly
  // rather than relying on a column default, so it's obvious at the call
  // site whose row this becomes.
  const { data, error } = await supabase
    .from("fontane_projects")
    .insert({ name, data: body.project, user_id: user.id })
    .select("id, name, updated_at")
    .single();
  if (error) {
    return Response.json({ error: "save failed" }, { status: 500 });
  }
  return Response.json({ project: data });
}
