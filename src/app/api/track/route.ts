import { createHash } from "crypto";
import { ipAddress, geolocation } from "@vercel/functions";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Every variant also carries `session` — a random per-page-load id from
// lib/analytics.ts, stored as-is (see fontane_events.sql for why that stays
// within the same privacy position as everything else here).
type TrackBody = { session?: string } & (
  | { type: "pageview"; referrer?: string | null; page?: string }
  | { type: "duration"; seconds: number; page?: string }
  | { type: "export"; format: string; bucket?: string | null }
  | { type: "tool_use"; tool: string; view?: string; pointer?: string | null }
  | { type: "undo"; tool?: string | null }
  | { type: "charset"; format: string; bucket?: string | null }
  | { type: "gate"; format: string }
  | { type: "error"; format: string }
);

// Anything client-supplied that lands in a column is clamped to a short
// string first — these are all meant to be fixed category labels, and a
// beacon is trivially forgeable, so the table should stay bounded even if
// someone posts nonsense at it by hand.
function label(value: unknown, max = 40): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

// Coarse device category from User-Agent — the full string is never stored,
// only this one-of-three label. iPad's UA on recent iPadOS omits "Mobile"
// and can even omit "iPad" (reports as a Mac UA) — not worth chasing further
// precision for an aggregate stat, "desktop" is an acceptable fallback there.
function deviceCategory(userAgent: string): "mobile" | "tablet" | "desktop" {
  const ua = userAgent.toLowerCase();
  if (/ipad/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return "tablet";
  if (/mobi|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}

// The primary language tag from the Accept-Language header the browser
// sends with every request on its own — "de-DE,de;q=0.9,en;q=0.8" becomes
// "de". Read here rather than from navigator.language in the browser on
// purpose: this header arrives as part of the request the visitor is
// already making, so nothing queries their device for it. Only the two
// letters are kept, never the full header (its quality-value ordering is a
// meaningful fingerprinting surface, the bare language code is not).
function primaryLanguage(header: string | null): string | null {
  const tag = header?.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return tag && /^[a-z]{2}$/.test(tag) ? tag : null;
}

// Global Privacy Control, and the older Do Not Track. GPC is an explicit,
// machine-readable objection to processing — the kind Art. 21(1) gives every
// visitor the right to raise, and honouring it in code is the only way to
// actually give effect to that right on a site with no account and no
// settings screen to store a preference in. DNT means the same thing from an
// older generation of browsers and costs nothing to respect too. Neither
// requires reading anything from the device: both arrive as request headers.
// This sits alongside ?notrack (which stops the beacon before it is even
// sent) rather than replacing it.
function hasOptedOut(request: Request): boolean {
  return request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1";
}

// Comma-separated raw IPs (ANALYTICS_EXCLUDED_IPS in Vercel/.env.local) —
// e.g. your own, so testing/checking the live site doesn't skew the visitor
// count. Compared against the request's IP only in-memory, per request;
// never written anywhere, so this doesn't reintroduce the raw-IP storage the
// fingerprint below deliberately avoids.
const EXCLUDED_IPS = new Set(
  (process.env.ANALYTICS_EXCLUDED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
);

// A same-day, non-reversible fingerprint from IP+User-Agent — used only to
// approximate "unique visitors" (SELECT DISTINCT over this value), never
// stored as, or convertible back to, the raw IP. Rotates at midnight UTC (the
// date is baked into the hash input), so the same person on two different
// days is deliberately uncounted as the same visitor — the tradeoff GDPR/
// ePrivacy compliance needs here, since nothing is ever stored on the
// visitor's own device (see src/lib/analytics.ts) and nothing server-side
// lets you go from this value back to who it was.
function dailyVisitorFingerprint(ip: string, userAgent: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT ?? "fontane-analytics";
  return createHash("sha256").update(`${salt}:${today}:${ip}:${userAgent}`).digest("hex");
}

// Only the real production deployment (fontane.studio) may ever write a row
// — `next dev` and Vercel preview/branch deployments both fall through this
// unwritten. IP-based exclusion (below) only catches whatever IP a given
// local setup happens to present, which isn't reliable (a proxy in front of
// `next dev` can hand out a different IP per request) — gating on the
// deployment itself is the only check that can't be bypassed by network
// path. VERCEL_ENV is unset locally, so this also covers plain `next dev`.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

// Fire-and-forget event intake for the /anneliese mini-analytics page. A
// missing Supabase config (env vars not set yet) just no-ops instead of
// breaking the beacon — the client never even reads this response
// (sendBeacon doesn't expose it), so there's nothing to report back anyway.
export async function POST(request: Request) {
  let body: TrackBody;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  if (!IS_PRODUCTION) {
    return new Response(null, { status: 204 });
  }

  // Checked before anything is read, derived or written — an objection that
  // only takes effect after the row exists is not an objection.
  if (hasOptedOut(request)) {
    return new Response(null, { status: 204 });
  }

  const ip = ipAddress(request) ?? "unknown";
  if (EXCLUDED_IPS.has(ip)) {
    return new Response(null, { status: 204 });
  }

  const supabase = getSupabase();
  if (supabase) {
    // On every row, whatever the type — it's what makes "did this visit draw
    // anything" answerable at all.
    const session = label(body.session, 64);
    try {
      if (body.type === "pageview") {
        const userAgent = request.headers.get("user-agent") ?? "unknown";
        await supabase.from("fontane_events").insert({
          type: "pageview",
          session_id: session,
          visitor_id: dailyVisitorFingerprint(ip, userAgent),
          referrer: body.referrer ?? null,
          page: label(body.page) ?? "editor",
          language: primaryLanguage(request.headers.get("accept-language")),
          country: geolocation(request).country ?? null,
          device: deviceCategory(userAgent),
        });
      } else if (body.type === "duration" && Number.isFinite(body.seconds)) {
        // Reuses the existing `page` column (added for pageviews) — no new
        // column needed for per-view time, and still just a fixed category
        // string, never a path or URL.
        await supabase.from("fontane_events").insert({
          type: "duration",
          session_id: session,
          seconds: Math.round(body.seconds),
          page: label(body.page),
        });
      } else if (body.type === "export" && body.format) {
        await supabase
          .from("fontane_events")
          .insert({ type: "export", session_id: session, format: label(body.format), bucket: label(body.bucket, 8) });
      } else if (body.type === "tool_use" && body.tool) {
        // Reuses the `format` column for the tool and the `page` column for
        // the view — both unused for this type, same aggregate-count shape as
        // exports-by-format (see fontane_events.sql).
        await supabase.from("fontane_events").insert({
          type: "tool_use",
          session_id: session,
          format: label(body.tool),
          page: label(body.view),
          pointer: label(body.pointer, 8),
        });
      } else if (body.type === "undo") {
        await supabase
          .from("fontane_events")
          .insert({ type: "undo", session_id: session, format: label(body.tool) ?? "unknown" });
      } else if (body.type === "charset" && body.format) {
        await supabase
          .from("fontane_events")
          .insert({ type: "charset", session_id: session, format: label(body.format), bucket: label(body.bucket, 8) });
      } else if ((body.type === "gate" || body.type === "error") && body.format) {
        await supabase.from("fontane_events").insert({ type: body.type, session_id: session, format: label(body.format) });
      }
    } catch {
      // Supabase reachable but the query itself failed (bad table/policy) —
      // still best-effort telemetry, never surface an error to the client.
    }
  }

  return new Response(null, { status: 204 });
}
