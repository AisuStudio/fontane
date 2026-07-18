import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Download links point here (not straight at the public Storage URL) so the
// download_count can be tracked, then redirects to the actual file. Count
// updates aren't atomic (read-then-write) — acceptable for an MVP counter,
// not billing-grade.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  const { data: font, error } = await supabase
    .from("fontane_fonts")
    .select("id, download_count")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !font) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await supabase.from("fontane_fonts").update({ download_count: font.download_count + 1 }).eq("id", font.id);

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicUrl = `${baseUrl}/storage/v1/object/public/fonts/${slug}.otf`;
  return Response.redirect(publicUrl, 302);
}
