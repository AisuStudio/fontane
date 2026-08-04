import type { getSupabase } from "./supabase";

// The publish gate, lifted out of the old single publish route when that route
// became two (start/finish). Both halves check it: `start` so nothing is ever
// uploaded that wouldn't have been accepted, `finish` so a signed URL handed
// out earlier can't be turned into a listing by a client that skips ahead.

// Provenance publish gate — see the provenance plan's Decisions §2. A
// deliberately loose starting point (bias toward not blocking real small
// fonts): tune from here once real usage exists.
const MIN_PROVENANCE_EVENTS = 15;
const MIN_PROVENANCE_SPAN_MS = 3 * 60 * 1000; // 3 minutes, first event to last
const PROVENANCE_SPREAD_BUCKETS = 3; // events must land in all 3 thirds of the span, not just clustered at the ends

type Supabase = NonNullable<ReturnType<typeof getSupabase>>;

// Adds "https://" when a URL has no scheme at all, so a homepage typed as
// "example.com" still renders as a working link rather than a relative one.
export function normalizeAuthorUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// A font is only publishable if the backend holds a real, server-timestamped
// record of it being drawn over time — not just this request's file. Checks
// count, real elapsed time span, and spread (catches "one old dummy event +
// a scripted burst just before publish" gaming the count/span thresholds
// alone). created_at is stamped by Postgres on insert (api/provenance/
// events/route.ts), never client-supplied, so this can't be backdated.
export async function checkProvenance(
  supabase: Supabase,
  draftId: string,
  authorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: events, error } = await supabase
    .from("fontane_provenance_events")
    .select("created_at")
    .eq("draft_id", draftId)
    .eq("author_id", authorId)
    .order("created_at", { ascending: true });

  if (error) return { ok: false, error: "provenance lookup failed" };
  if (!events || events.length < MIN_PROVENANCE_EVENTS) {
    return {
      ok: false,
      error:
        "This font doesn't have enough recorded drawing history to publish yet — keep drawing directly in Fontane.",
    };
  }

  const first = new Date(events[0].created_at).getTime();
  const last = new Date(events[events.length - 1].created_at).getTime();
  const spanMs = last - first;
  if (spanMs < MIN_PROVENANCE_SPAN_MS) {
    return { ok: false, error: "This font's drawing history doesn't span enough real time to publish yet." };
  }

  const bucketMs = spanMs / PROVENANCE_SPREAD_BUCKETS;
  const buckets = new Set<number>();
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    buckets.add(Math.min(PROVENANCE_SPREAD_BUCKETS - 1, Math.floor((t - first) / bucketMs)));
  }
  if (buckets.size < PROVENANCE_SPREAD_BUCKETS) {
    return {
      ok: false,
      error: "This font's drawing history looks too clustered to publish yet — keep drawing directly in Fontane.",
    };
  }

  return { ok: true };
}

export type PublishRequest = {
  name: string;
  draftId: string;
  authorId: string;
  glyphCount: number;
  authorName: string | null;
  authorUrl: string | null;
};

// Shared shape check for both halves. Returns a message rather than throwing
// so each route can decide its own status code.
export function readPublishRequest(body: unknown): { ok: true; value: PublishRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "missing name" };
  if (b.licenseAccepted !== true) return { ok: false, error: "license not accepted" };
  if (typeof b.draftId !== "string" || !b.draftId || typeof b.authorId !== "string" || !b.authorId) {
    return { ok: false, error: "missing provenance identifiers" };
  }
  const authorName = typeof b.authorName === "string" && b.authorName.trim() ? b.authorName.trim() : null;
  const authorUrl =
    typeof b.authorUrl === "string" && b.authorUrl.trim() ? normalizeAuthorUrl(b.authorUrl.trim()) : null;
  return {
    ok: true,
    value: {
      name,
      draftId: b.draftId,
      authorId: b.authorId,
      glyphCount: typeof b.glyphCount === "number" ? b.glyphCount : 0,
      authorName,
      authorUrl,
    },
  };
}
