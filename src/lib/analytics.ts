// Minimal analytics: no client-side storage at all (no cookie, no
// localStorage) — nothing is written to the visitor's device, so this never
// triggers ePrivacy/GDPR's consent requirement for storing/reading
// information on a user's terminal equipment. "Unique visitors" is instead
// approximated server-side (see api/track/route.ts) from a daily-rotating
// hash of IP+User-Agent that's never itself stored — an accepted
// less-than-perfect count (the same person across two days counts twice) in
// exchange for not tracking anyone. Session-duration and export-format
// events carry no identifier at all. Every send is fire-and-forget via
// sendBeacon (falls back to fetch with keepalive where unavailable) so it
// never blocks or breaks the drawing UI, and every failure is swallowed —
// analytics must never be able to throw into the caller.

// An explicit, manual opt-out — visit fontane.studio/?notrack and nothing
// for that page load ever gets sent. Complements the IP allowlist in
// api/track/route.ts (automatic, but tied to a specific IP that can change);
// this works from anywhere, no IP to know or maintain. Checked once per
// page load rather than persisted anywhere, matching the "nothing written to
// the visitor's own device" rule above — the param has to be present on
// every visit you want excluded, but that's the same one-time cost as
// bookmarking the URL.
function isTrackingSuppressed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("notrack");
}

// A random id for THIS page load, held in nothing but this module variable —
// it is never written to a cookie, to localStorage, or anywhere else on the
// visitor's device, so the "nothing stored on your terminal equipment" rule
// above (and the consent exemption that follows from it) is untouched. It is
// also strictly less identifying than visitor_id: that one is derived from
// the IP, this one from a random number. A reload, a second tab, or the next
// day is a different session by construction — this can only group events
// *within* one visit, which is exactly what it's for: "did this visit draw
// anything", "did it get to an export", "how long until the first stroke".
// None of those are answerable from unlinked counts, and all of them are the
// difference between knowing something is used and knowing it works.
let sessionId: string | null = null;
function getSessionId(): string {
  if (!sessionId) {
    sessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  return sessionId;
}

// The last tool that reported a use, and the last pointer type seen on the
// canvas. Both are single values in memory, overwritten constantly, never
// sent on their own — they only ride along on the event they qualify, so an
// undo can say *what* was undone and a stroke can say whether it came from a
// stylus. See notePointer() below.
let lastTool: string | null = null;
let lastPointer: string | null = null;

// Called from the canvas pointer handlers. PointerEvent.pointerType is
// already one of a tiny fixed set ("pen" | "touch" | "mouse"), and anything
// else collapses to "other" rather than being passed through — the point is
// the coarse capability (does this person draw with a stylus?), not the
// device string.
export function notePointer(pointerType: string) {
  if (!pointerType) return;
  lastPointer = pointerType === "pen" || pointerType === "touch" || pointerType === "mouse" ? pointerType : "other";
}

// Five buckets, never the exact number: enough to tell "tried three letters"
// from "built a typeface" — which is the sharpest signal there is for what
// the tool is actually being used for — without the count itself ever
// describing a specific document.
export function glyphBucket(drawnGlyphs: number): string {
  if (drawnGlyphs <= 0) return "0";
  if (drawnGlyphs <= 5) return "1-5";
  if (drawnGlyphs <= 20) return "6-20";
  if (drawnGlyphs <= 60) return "21-60";
  return "60+";
}

function send(payload: Record<string, unknown>) {
  if (typeof window === "undefined" || isTrackingSuppressed()) return;
  try {
    const body = JSON.stringify({ ...payload, session: getSessionId() });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // analytics must never throw into the caller
  }
}

// Just the referring hostname (e.g. "google.com"), not the full referrer URL
// — enough to tell direct traffic (empty) from everything else, or later
// break down by source, without carrying over query strings/search terms
// that can leak into document.referrer.
function getReferrerHost(): string | null {
  if (!document.referrer) return null;
  try {
    const host = new URL(document.referrer).hostname;
    return host === window.location.hostname ? null : host;
  } catch {
    return null;
  }
}

// "editor" (default, the main tool) | "marketplace" | "marketplace-listing"
// — lets the dashboard compute a marketplace browse→download ratio. Only
// ever a fixed category string, not a path/URL.
export function trackPageview(page: string = "editor") {
  // Language is deliberately NOT read here. navigator.language would mean
  // actively querying the visitor's device through a JS API and shipping the
  // answer out — which the EDPB's guidance on the technical scope of
  // ePrivacy Art. 5(3) treats as "gaining access to information stored in
  // terminal equipment", i.e. the consent-requiring kind, regardless of how
  // harmless the value is. The Accept-Language header the browser sends on
  // its own anyway carries the same two letters without anyone asking the
  // device for anything, so the language is derived server-side from that
  // instead (see api/track/route.ts). Same number, no access.
  send({ type: "pageview", referrer: getReferrerHost(), page });
}

// `page` here is the finer view label (e.g. "editor:grid", "marketplace")
// rather than the pageview's coarse surface — one duration row per visible
// segment, so per-view time adds up. See lib/visitDuration.ts.
export function trackDuration(seconds: number, page?: string) {
  if (seconds < 1) return;
  send({ type: "duration", seconds: Math.round(seconds), page });
}

// `drawnGlyphs` is the number of glyphs the exported document actually had
// anything in — sent as a bucket, never the raw count (see glyphBucket).
export function trackExport(format: string, drawnGlyphs?: number) {
  send({ type: "export", format, bucket: drawnGlyphs == null ? null : glyphBucket(drawnGlyphs) });
}

// One ping per completed tool action (a finished stroke, a placed Vector
// anchor, a Move/Rotate/Scale/Nudge/Assign that actually changed something)
// — which tool, not what it did or on what content. `view` is the same
// label duration rows carry ("studio:grid", …): the same tool means
// different things in Grid and in the Editor, and only the pair says which
// of the two is worth building on.
export function trackToolUse(tool: string, view?: string) {
  lastTool = tool;
  send({ type: "tool_use", tool, view, pointer: lastPointer });
}

// One row per undo, tagged with the tool that last reported a use. Usage
// counts say a tool gets reached for; the share of those uses immediately
// undone is the only cheap signal for whether it behaved as expected.
export function trackUndo() {
  send({ type: "undo", tool: lastTool });
}

// A character set switched on or off in Grid — which glyph coverage people
// reach for beyond the default, which is a want, not just a use.
export function trackCharset(setId: string, enabled: boolean) {
  send({ type: "charset", format: setId, bucket: enabled ? "on" : "off" });
}

// A wall someone hit and couldn't pass (`what` = which wall, e.g.
// "cloud-code"). Not a failure to log — a request for the thing behind it.
export function trackGate(what: string) {
  send({ type: "gate", format: what });
}

// A user-visible failure, by location ("export:otf", …). Export events fire
// when the button is pressed, so without this a broken export and a working
// one are the same row.
export function trackError(where: string) {
  send({ type: "error", format: where });
}

// A real account being created or a returning sign-in — the one auth signal
// worth its own type rather than reusing "gate" (that's for a WALL someone
// hit, and a successful sign-up/login is the opposite of that) or "export"
// (no format/bucket relationship to a font export at all). `action` is
// "signup" | "login" — kept as a free string, not a union, so a new call
// site elsewhere doesn't need this file to change first.
export function trackAuth(action: string) {
  send({ type: "auth", format: action });
}

// The coach marks tour's outcome: "started" once per tour instance
// (auto-launch or a deliberate "Show tour again"), "completed" if Done was
// reached, or "skipped:N" with the 1-based step it was skipped at. The step
// number is exact, not bucketed — it's a UI position, not document content,
// same precision level as trackToolUse's tool name.
export function trackTour(what: string) {
  send({ type: "tour", format: what });
}
