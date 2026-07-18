import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// Live availability check while the user types a font name in the Publish
// modal. This is UX feedback only, not a lock — api/fonts/publish re-checks
// the slug server-side before actually inserting, since a name could be
// taken between this check and the real publish request.
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const slug = slugify(name);

  if (!slug) {
    return Response.json({ slug, available: false, error: "empty" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ slug, available: false, error: "backend unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase.from("fontane_fonts").select("id").eq("slug", slug).maybeSingle();
  if (error) {
    return Response.json({ slug, available: false, error: "lookup failed" }, { status: 500 });
  }

  return Response.json({ slug, available: !data });
}
