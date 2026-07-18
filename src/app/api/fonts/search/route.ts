import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Backs the "Share Font" modal — look a published font up by name to grab
// its link. Not a full marketplace search UI, just enough to find a font
// you (or someone else) already published.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return Response.json({ results: [] });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ results: [], error: "backend unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("fontane_fonts")
    .select("slug, display_name")
    .ilike("display_name", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return Response.json({ results: [], error: "search failed" }, { status: 500 });
  }

  return Response.json({ results: data ?? [] });
}
