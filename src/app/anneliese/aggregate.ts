// Every /anneliese number, computed from plain rows — no Supabase, no React,
// no clock of its own. data.ts fetches and calls in here; this file is where
// "what does the number mean" lives, and the only reason it is its own
// module: session funnels and visit-length distributions are real arithmetic
// with real edge cases (a visit with no duration row, an export with no
// session, a range whose data starts halfway through), and arithmetic that
// can only be exercised by pointing the live site at it is arithmetic nobody
// checks. Pure in, pure out, so it can be run against made-up rows.

import { daysBetween, isoDate, type DateRange, type Filters } from "./filters";

// Categorical order is fixed per-slot, not re-derived per render: Direct is
// always the first slot/color, "Other" is always the last — only the middle
// three (the actual top referrer hosts for the selected range) vary. Colors
// are the dataviz skill's validated default categorical palette, checked
// against this page's cream surface (#eae8e0): all 5 pass lightness/chroma/
// CVD; aqua and yellow fall under the 3:1 contrast floor against this
// surface, which is why every segment also gets a direct label rather than
// relying on color alone (the skill's "relief rule").
const DIRECT_COLOR = "#2a78d6"; // blue
const OTHER_COLOR = "#4a3aa7"; // violet
const REFERRER_COLORS = ["#1baf7a", "#eda100", "#008300"]; // aqua, yellow, green
const MAX_NAMED_REFERRERS = REFERRER_COLORS.length;

export type SourceSlice = { label: string; count: number; color: string };
export type Bucket = { label: string; total: number; sources: SourceSlice[] };
export type Ranked = { label: string; count: number };

// One row of fontane_events, exactly as stored — see supabase/fontane_events.sql.
export type EventRow = {
  type: string;
  session_id: string | null;
  seconds: number | null;
  format: string | null;
  referrer: string | null;
  country: string | null;
  device: string | null;
  language: string | null;
  page: string | null;
  pointer: string | null;
  bucket: string | null;
  created_at: string;
};

// One legend entry per actual source: Facebook alone otherwise shows up as
// www.facebook.com / m.facebook.com / lm.facebook.com depending on app and
// link shim — collapse the common host prefixes so one source aggregates
// into one slice instead of occupying several "top referrer" slots.
function normalizeReferrer(host: string): string {
  return host.replace(/^(www|m|mobile|l|lm|web)\./, "");
}

// The device segment can only be applied through the session: `device` is
// recorded on pageview rows (it comes from the User-Agent), while a
// tool_use or export row has no device of its own. Sessions are how the two
// are connected — which also means events from before session_id existed
// (2026-07-25) drop out of a segmented view entirely, rather than being
// silently attributed to whichever segment is selected. Each section says
// what it covers rather than pretending the gap isn't there.
function sessionsForDevice(rows: EventRow[], device: string | null): Set<string> | null {
  if (!device) return null;
  const sessions = new Set<string>();
  for (const r of rows) {
    if (r.type === "pageview" && r.session_id && r.device === device) sessions.add(r.session_id);
  }
  return sessions;
}

function countBy(rows: EventRow[], key: (r: EventRow) => string | null | undefined): Ranked[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const value = key(r);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// Long tails get one "Other" row rather than an unbounded list — the same
// rule the source chart already followed, applied to the tables that didn't.
export function topN(entries: Ranked[], n: number): Ranked[] {
  if (entries.length <= n) return entries;
  const rest = entries.slice(n).reduce((sum, e) => sum + e.count, 0);
  return [...entries.slice(0, n), { label: "Other", count: rest }];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// The date a dimension starts existing, when that's later than the range
// being viewed. Every metric here was added at some point, and a metric
// whose data begins mid-range reads as a collapse in the numbers unless the
// page says so — this is what produced the nonsensical "0 views, 7
// downloads" tile once already, so it's now computed for every section
// rather than hand-maintained for one.
function coverageSince(rows: EventRow[], has: (r: EventRow) => boolean, from: string): string | null {
  let earliest: string | null = null;
  for (const r of rows) {
    if (!has(r)) continue;
    if (!earliest || r.created_at < earliest) earliest = r.created_at;
  }
  const day = earliest?.slice(0, 10);
  return day && day > from ? day : null;
}

// Per session: the total visible time, and how long until the first tool
// action. Duration rows are one per visible view segment, so a visit is the
// SUM of its segments — taking a median across raw rows (as this page used
// to) measures segments, not visits, and a visit that switched views three
// times counted three times.
type SessionFacts = { seconds: number; drew: boolean; exported: boolean; timeToFirstTool: number | null };

function sessionFacts(rows: EventRow[]): Map<string, SessionFacts> {
  const facts = new Map<string, SessionFacts>();
  const firstSeen = new Map<string, number>();
  const firstTool = new Map<string, number>();
  const get = (id: string) => {
    const existing = facts.get(id);
    if (existing) return existing;
    const fresh: SessionFacts = { seconds: 0, drew: false, exported: false, timeToFirstTool: null };
    facts.set(id, fresh);
    return fresh;
  };

  for (const r of rows) {
    const id = r.session_id;
    if (!id) continue;
    const at = new Date(r.created_at).getTime();
    if (r.type === "pageview" && !firstSeen.has(id)) firstSeen.set(id, at);
    if (r.type === "duration" && r.seconds != null) get(id).seconds += r.seconds;
    if (r.type === "tool_use") {
      get(id).drew = true;
      if (!firstTool.has(id)) firstTool.set(id, at);
    }
    // marketplace-download rows are inserted server-side by the download
    // route and carry no session — they're a marketplace fact, not evidence
    // that this visit got a font out of the editor.
    if (r.type === "export" && r.format !== "marketplace-download") get(id).exported = true;
  }

  for (const [id, start] of firstSeen) {
    const tool = firstTool.get(id);
    if (tool != null && tool >= start) get(id).timeToFirstTool = (tool - start) / 1000;
  }
  return facts;
}

// The four numbers the funnel is drawn from. Sessions are the unit
// throughout: "23 tool uses" can be one determined person, "9 of 40 visits
// drew something" cannot.
function funnelOf(rows: EventRow[]) {
  const sessions = new Set<string>();
  const drew = new Set<string>();
  const exported = new Set<string>();
  const published = new Set<string>();
  for (const r of rows) {
    if (!r.session_id) continue;
    if (r.type === "pageview") sessions.add(r.session_id);
    if (r.type === "tool_use") drew.add(r.session_id);
    if (r.type === "export" && r.format !== "marketplace-download") exported.add(r.session_id);
    if (r.type === "export" && r.format === "marketplace-publish") published.add(r.session_id);
  }
  return { sessions: sessions.size, drew: drew.size, exported: exported.size, published: published.size };
}

// Visit lengths are bimodal — a bounce and a working session are two
// populations, and one median between them describes neither. Fixed
// boundaries (not quantiles) so the buckets mean the same thing across
// ranges and the shape is comparable week to week.
const DURATION_BINS = [
  { label: "< 10s", max: 10 },
  { label: "10–60s", max: 60 },
  { label: "1–5m", max: 300 },
  { label: "5–30m", max: 1800 },
  { label: "> 30m", max: Infinity },
];

function histogram(values: number[]): Ranked[] {
  return DURATION_BINS.map((bin, i) => {
    const min = i === 0 ? -Infinity : DURATION_BINS[i - 1].max;
    return { label: bin.label, count: values.filter((v) => v > min && v <= bin.max).length };
  });
}

function buildBuckets(pageviews: EventRow[], range: DateRange) {
  const referrerTotals = new Map<string, number>();
  for (const r of pageviews) {
    if (!r.referrer) continue;
    const host = normalizeReferrer(r.referrer);
    referrerTotals.set(host, (referrerTotals.get(host) ?? 0) + 1);
  }
  const topReferrers = [...referrerTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NAMED_REFERRERS)
    .map(([host]) => host);

  const monthly = daysBetween(range.from, range.to) > 31;
  const bucketOf = (createdAt: string) => (monthly ? createdAt.slice(0, 7) : createdAt.slice(0, 10)); // "YYYY-MM" or "YYYY-MM-DD"
  const bucketLabel = (key: string) =>
    monthly
      ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
      : new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  // Pre-seed every bucket in range (not just ones with data) so the chart
  // has no silent gaps.
  const bucketKeys: string[] = [];
  if (monthly) {
    const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
    const end = new Date(`${range.to.slice(0, 7)}-01T00:00:00Z`);
    while (cursor <= end) {
      bucketKeys.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const cursor = new Date(`${range.from}T00:00:00Z`);
    const end = new Date(`${range.to}T00:00:00Z`);
    while (cursor <= end) {
      bucketKeys.push(isoDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const countsByBucket = new Map<string, Map<string, number>>(); // bucketKey -> sourceLabel -> count
  for (const r of pageviews) {
    const key = bucketOf(r.created_at);
    const normalized = r.referrer ? normalizeReferrer(r.referrer) : null;
    const source = !normalized ? "Direct" : topReferrers.includes(normalized) ? normalized : "Other";
    const bySource = countsByBucket.get(key) ?? new Map<string, number>();
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
    countsByBucket.set(key, bySource);
  }

  const sourceOrder = ["Direct", ...topReferrers, "Other"];
  const colorFor = (source: string) =>
    source === "Direct" ? DIRECT_COLOR : source === "Other" ? OTHER_COLOR : REFERRER_COLORS[topReferrers.indexOf(source)];

  const buckets: Bucket[] = bucketKeys.map((key) => {
    const bySource = countsByBucket.get(key);
    const sources: SourceSlice[] = sourceOrder
      .map((label) => ({ label, count: bySource?.get(label) ?? 0, color: colorFor(label) }))
      .filter((s) => s.count > 0);
    return { label: bucketLabel(key), total: sources.reduce((sum, s) => sum + s.count, 0), sources };
  });

  const legend = sourceOrder
    .filter((label) => label === "Direct" || label === "Other" || topReferrers.includes(label))
    .filter((label) => buckets.some((b) => b.sources.some((s) => s.label === label)))
    .map((label) => ({ label, color: colorFor(label) }));

  return { buckets, legend, sparkline: buckets.map((b) => b.total) };
}

// Which source brings people who actually DO something, not just people who
// arrive — the difference between a referrer that's worth pursuing and one
// that's worth ignoring, and the single combination this dashboard was most
// obviously missing.
function sourceQuality(
  rows: EventRow[],
  facts: Map<string, SessionFacts>
): { label: string; sessions: number; drew: number; exported: number }[] {
  const bySession = new Map<string, string>(); // session -> source label
  for (const r of rows) {
    if (r.type !== "pageview" || !r.session_id || bySession.has(r.session_id)) continue;
    bySession.set(r.session_id, r.referrer ? normalizeReferrer(r.referrer) : "Direct");
  }
  const grouped = new Map<string, { sessions: number; drew: number; exported: number }>();
  for (const [session, source] of bySession) {
    const entry = grouped.get(source) ?? { sessions: 0, drew: 0, exported: 0 };
    entry.sessions += 1;
    const f = facts.get(session);
    if (f?.drew) entry.drew += 1;
    if (f?.exported) entry.exported += 1;
    grouped.set(source, entry);
  }
  return [...grouped.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.sessions - a.sessions);
}

function scope(rows: EventRow[], device: string | null): EventRow[] {
  const allowed = sessionsForDevice(rows, device);
  if (!allowed) return rows;
  return rows.filter((r) => r.session_id && allowed.has(r.session_id));
}


// ------------------------------------------------- the two page view-models

export type OverviewData = ReturnType<typeof computeOverview>;

export function computeOverview(input: {
  allRows: EventRow[];
  prevAllRows: EventRow[];
  allTimeVisits: number;
  filters: Filters;
}) {
  const { allRows, prevAllRows, allTimeVisits, filters } = input;
  const rows = scope(allRows, filters.device);
  const prevRows = scope(prevAllRows, filters.device);
  const pageviews = rows.filter((r) => r.type === "pageview");

  const facts = sessionFacts(rows);
  const prevFacts = sessionFacts(prevRows);
  const visitSeconds = [...facts.values()].map((f) => f.seconds).filter((s) => s > 0);
  const prevVisitSeconds = [...prevFacts.values()].map((f) => f.seconds).filter((s) => s > 0);
  const timesToFirstTool = [...facts.values()].map((f) => f.timeToFirstTool).filter((v): v is number => v != null);

  const funnel = funnelOf(rows);
  const prevFunnel = funnelOf(prevRows);
  const rate = (n: number, d: number) => (d > 0 ? n / d : null);

  return {
    ok: true as const,
    allTimeVisits,
    visits: pageviews.length,
    prevVisits: prevRows.filter((r) => r.type === "pageview").length,
    medianVisitSeconds: median(visitSeconds),
    prevMedianVisitSeconds: median(prevVisitSeconds),
    activation: rate(funnel.drew, funnel.sessions),
    prevActivation: rate(prevFunnel.drew, prevFunnel.sessions),
    medianTimeToFirstTool: timesToFirstTool.length ? median(timesToFirstTool) : null,
    funnel,
    durationHistogram: histogram(visitSeconds),
    sessionsMeasured: visitSeconds.length,
    sources: sourceQuality(rows, facts),
    ...buildBuckets(pageviews, filters),
    directCount: pageviews.filter((r) => !r.referrer).length,
    referredCount: pageviews.filter((r) => r.referrer).length,
    topCountries: topN(countBy(pageviews, (r) => r.country), 6),
    topDevices: countBy(pageviews, (r) => r.device),
    topLanguages: topN(countBy(pageviews, (r) => r.language), 6),
    sessionsSince: coverageSince(allRows, (r) => r.session_id != null, filters.from),
  };
}

export type ToolRow = { tool: string; byView: Record<string, number>; total: number; undos: number };
export type DetailData = ReturnType<typeof computeDetail>;

// Fixed order, not by frequency: export size is an ordinal scale (how much
// was built), and sorting it by count would destroy the only thing its shape
// is for — seeing whether the mass sits at the small end or the large.
const SIZE_ORDER = ["0", "1-5", "6-20", "21-60", "60+"];

export function computeDetail(input: { allRows: EventRow[]; filters: Filters }) {
  const { allRows, filters } = input;
  const rows = scope(allRows, filters.device);

  // Tool × view. The same tool means different things in Grid and in the
  // Editor, and the pair is what says which of the two is worth building on
  // — a flat "vector: 214" says only that the button exists.
  const toolUses = rows.filter((r) => r.type === "tool_use");
  const views = [...new Set(toolUses.map((r) => r.page ?? "unlabelled"))].sort();
  const undoCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "undo" || !r.format) continue;
    undoCounts.set(r.format, (undoCounts.get(r.format) ?? 0) + 1);
  }
  const toolMap = new Map<string, ToolRow>();
  for (const r of toolUses) {
    if (!r.format) continue;
    const entry = toolMap.get(r.format) ?? { tool: r.format, byView: {}, total: 0, undos: 0 };
    const view = r.page ?? "unlabelled";
    entry.byView[view] = (entry.byView[view] ?? 0) + 1;
    entry.total += 1;
    toolMap.set(r.format, entry);
  }
  for (const entry of toolMap.values()) entry.undos = undoCounts.get(entry.tool) ?? 0;
  const tools = [...toolMap.values()].sort((a, b) => b.total - a.total);

  // Median, not mean, per view: duration rows are heavy-tailed — a handful
  // of tabs left open for hours dragged the mean to 26m56s while the median
  // sat at 31s. One row per visible segment (see lib/visitDuration.ts), so a
  // visit that moves Grid → Free → Animate contributes to all three. Rows
  // predating per-view labels have page=NULL and are excluded rather than
  // lumped into a fake bucket.
  const durationsByView = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type !== "duration" || !r.page || r.seconds == null) continue;
    const list = durationsByView.get(r.page) ?? [];
    list.push(r.seconds);
    durationsByView.set(r.page, list);
  }
  const timeByView = [...durationsByView.entries()]
    .map(([view, values]) => ({
      view,
      medianSeconds: median(values),
      totalSeconds: values.reduce((a, b) => a + b, 0),
      samples: values.length,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  const exportRows = rows.filter((r) => r.type === "export");
  const sizeCounts = countBy(exportRows, (r) => r.bucket);
  const exportSizes = SIZE_ORDER.map((label) => ({
    label: label === "0" ? "empty" : `${label} glyphs`,
    count: sizeCounts.find((e) => e.label === label)?.count ?? 0,
  }));

  const charsetMap = new Map<string, { on: number; off: number }>();
  for (const r of rows) {
    if (r.type !== "charset" || !r.format) continue;
    const entry = charsetMap.get(r.format) ?? { on: 0, off: 0 };
    if (r.bucket === "off") entry.off += 1;
    else entry.on += 1;
    charsetMap.set(r.format, entry);
  }
  const charsets = [...charsetMap.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.on - a.on);

  const pageviews = rows.filter((r) => r.type === "pageview");
  return {
    ok: true as const,
    views,
    tools,
    totalUndos: rows.filter((r) => r.type === "undo").length,
    pointerMix: countBy(toolUses, (r) => r.pointer),
    timeByView,
    exports: countBy(exportRows, (r) => r.format),
    exportSizes,
    charsets,
    // Aggregate browse→download ratio, not a real per-visitor funnel:
    // downloads are logged server-side by the download route and carry no
    // session, by design (see fontane_events.sql). "views" counts both the
    // overview and individual listing pages.
    marketplaceViews: pageviews.filter((r) => r.page === "marketplace" || r.page === "marketplace-listing").length,
    marketplaceDownloads: exportRows.filter((r) => r.format === "marketplace-download").length,
    gates: countBy(rows, (r) => (r.type === "gate" ? r.format : null)),
    errors: countBy(rows, (r) => (r.type === "error" ? r.format : null)),
    toolViewSince: coverageSince(allRows, (r) => r.type === "tool_use" && r.page != null, filters.from),
    pointerSince: coverageSince(allRows, (r) => r.pointer != null, filters.from),
    exportSizeSince: coverageSince(allRows, (r) => r.type === "export" && r.bucket != null, filters.from),
    viewsTrackedSince: coverageSince(allRows, (r) => r.type === "pageview" && r.page != null, filters.from),
  };
}
