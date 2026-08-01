import { createClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// Full project JSON — only fetched on an explicit Load, not part of the
// list. RLS (auth.uid() = user_id, see supabase/fontane_projects_accounts.sql)
// scopes this to the signed-in user's own rows — an id belonging to someone
// else simply matches nothing.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("fontane_projects")
    .select("id, name, data, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ project: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const { error } = await supabase.from("fontane_projects").delete().eq("id", id);
  if (error) {
    return Response.json({ error: "delete failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
