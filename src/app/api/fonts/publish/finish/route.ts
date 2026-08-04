import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";
import { checkProvenance, readPublishRequest } from "@/lib/publishGate";

export const dynamic = "force-dynamic";

// Second half of publishing: the browser has uploaded to the signed URL, this
// makes the font visible by writing the row.
//
// Everything is re-checked rather than trusted from `start`. A signed URL is
// the only thing that crossed the wire in between, and it says nothing about
// who is calling now or whether the name is still free — so provenance, the
// slug and the object's existence are all verified again here. Cheap, and it
// keeps the two halves independently sound instead of relying on the client
// to run them in order.
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
  const { name, draftId, authorId, glyphCount, authorName, authorUrl } = parsed.value;

  const provenance = await checkProvenance(supabase, draftId, authorId);
  if (!provenance.ok) {
    return Response.json({ error: provenance.error }, { status: 403 });
  }

  const slug = slugify(name);
  if (!slug) {
    return Response.json({ error: "invalid name" }, { status: 400 });
  }

  // The upload happened out of our sight, so confirm the object is really
  // there before advertising it. Without this a client could skip the upload
  // entirely and list a font that 404s on download.
  const path = `${slug}.otf`;
  const { data: objects, error: listError } = await supabase.storage
    .from("fonts")
    .list("", { search: path, limit: 1 });
  if (listError) {
    return Response.json({ error: "upload verification failed" }, { status: 500 });
  }
  const object = objects?.find((o) => o.name === path);
  if (!object) {
    return Response.json({ error: "no uploaded font found for this name" }, { status: 400 });
  }
  const fileSize = (object.metadata as { size?: number } | null)?.size ?? 0;

  const { error: insertError } = await supabase.from("fontane_fonts").insert({
    slug,
    display_name: name,
    glyph_count: glyphCount,
    file_size: fileSize,
    license_accepted_at: new Date().toISOString(),
    author_name: authorName,
    author_url: authorUrl,
    draft_id: draftId,
    author_id: authorId,
  });
  if (insertError) {
    // Roll back the upload so a failed publish doesn't leave an orphaned file
    // — same guarantee the single-request version gave.
    await supabase.storage.from("fonts").remove([path]);
    return Response.json({ error: "publish failed" }, { status: 500 });
  }

  return Response.json({ slug });
}
