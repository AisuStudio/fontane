import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// Adds "https://" when a URL has no scheme at all, so a homepage typed as
// "example.com" still renders as a working link rather than a relative one.
function normalizeAuthorUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Publishing is anonymous and permanent by design (no accounts) — see
// the Marketplace plan. This route is the only writer to fontane_fonts
// and the "fonts" Storage bucket; the client-side check-slug call is just
// UX feedback, so the slug uniqueness is re-verified here for real.
export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid form data" }, { status: 400 });
  }

  const font = form.get("font");
  const name = form.get("name");
  const glyphCount = form.get("glyphCount");
  const licenseAccepted = form.get("licenseAccepted");
  const authorNameRaw = form.get("authorName");
  const authorUrlRaw = form.get("authorUrl");

  if (!(font instanceof Blob) || font.size === 0) {
    return Response.json({ error: "missing font file" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "missing name" }, { status: 400 });
  }
  if (licenseAccepted !== "true") {
    return Response.json({ error: "license not accepted" }, { status: 400 });
  }

  const slug = slugify(name);
  if (!slug) {
    return Response.json({ error: "invalid name" }, { status: 400 });
  }

  const authorName = typeof authorNameRaw === "string" && authorNameRaw.trim() ? authorNameRaw.trim() : null;
  const authorUrl =
    typeof authorUrlRaw === "string" && authorUrlRaw.trim() ? normalizeAuthorUrl(authorUrlRaw.trim()) : null;

  const { data: existing, error: lookupError } = await supabase
    .from("fontane_fonts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupError) {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }
  if (existing) {
    return Response.json({ error: "name already taken" }, { status: 409 });
  }

  const { error: uploadError } = await supabase.storage.from("fonts").upload(`${slug}.otf`, font, {
    contentType: "font/otf",
    upsert: false,
  });
  if (uploadError) {
    return Response.json({ error: "upload failed" }, { status: 500 });
  }

  const { error: insertError } = await supabase.from("fontane_fonts").insert({
    slug,
    display_name: name.trim(),
    glyph_count: typeof glyphCount === "string" ? parseInt(glyphCount, 10) || 0 : 0,
    file_size: font.size,
    license_accepted_at: new Date().toISOString(),
    author_name: authorName,
    author_url: authorUrl,
  });
  if (insertError) {
    // Roll back the upload so a failed publish doesn't leave an orphaned file.
    await supabase.storage.from("fonts").remove([`${slug}.otf`]);
    return Response.json({ error: "publish failed" }, { status: 500 });
  }

  return Response.json({ slug });
}
