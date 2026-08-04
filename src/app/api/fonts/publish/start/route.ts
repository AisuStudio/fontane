import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";
import { checkProvenance, readPublishRequest } from "@/lib/publishGate";

export const dynamic = "force-dynamic";

// First half of publishing: decide whether this font may be published, and if
// so hand back a signed URL the browser uploads to directly.
//
// The font itself never passes through here. It used to, and that put a hard
// ceiling on publishing that had nothing to do with fonts: a serverless
// function's request body is capped (4,5 MB on Vercel), and a Korean font is
// 4–6 MB because it carries thousands of composed syllables. The function was
// only ever handing the bytes to Supabase Storage anyway, so it now hands over
// permission instead and steps out of the data path.
//
// A side effect worth having: the gate runs BEFORE the upload. Until now
// someone uploaded several megabytes and was told afterwards that their
// drawing history wasn't sufficient.
export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const parsed = readPublishRequest(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { name, draftId, authorId } = parsed.value;

  const provenance = await checkProvenance(supabase, draftId, authorId);
  if (!provenance.ok) {
    return Response.json({ error: provenance.error }, { status: 403 });
  }

  const slug = slugify(name);
  if (!slug) {
    return Response.json({ error: "invalid name" }, { status: 400 });
  }

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

  // No upsert: a signed URL for a path that already holds an object fails,
  // which is the behaviour we want — it keeps a published font from being
  // overwritten via a stale URL, the same guarantee `upsert: false` gave the
  // old direct upload.
  const path = `${slug}.otf`;
  const { data: signed, error: signError } = await supabase.storage.from("fonts").createSignedUploadUrl(path);
  if (signError || !signed) {
    return Response.json({ error: "could not prepare upload" }, { status: 500 });
  }

  return Response.json({ slug, path: signed.path, token: signed.token });
}
