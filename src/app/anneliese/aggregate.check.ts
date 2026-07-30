// Throwaway check of the /anneliese arithmetic against hand-made rows.
import { computeOverview, computeDetail, type EventRow } from "./aggregate";

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${name} = ${a}`);
  }
}

const base: EventRow = {
  type: "pageview",
  session_id: null,
  seconds: null,
  format: null,
  referrer: null,
  country: null,
  device: null,
  language: null,
  page: null,
  pointer: null,
  bucket: null,
  created_at: "2026-07-20T10:00:00.000Z",
};
const row = (o: Partial<EventRow>): EventRow => ({ ...base, ...o });

// s1 desktop, direct: arrives, draws after 30s, exports. 120s + 60s visible.
// s2 mobile, google: arrives, draws, never exports. 8s visible.
// s3 desktop, google: arrives, never draws. 5s visible.
// s4 desktop, direct: arrives, draws, exports, publishes. 3000s visible.
// legacy: a pageview from before sessions existed.
const rows: EventRow[] = [
  row({ session_id: "s1", device: "desktop", created_at: "2026-07-20T10:00:00.000Z" }),
  row({ type: "tool_use", session_id: "s1", format: "pen", page: "studio:grid", pointer: "pen", created_at: "2026-07-20T10:00:30.000Z" }),
  row({ type: "tool_use", session_id: "s1", format: "vector", page: "studio:editor", pointer: "mouse", created_at: "2026-07-20T10:01:00.000Z" }),
  row({ type: "undo", session_id: "s1", format: "vector", created_at: "2026-07-20T10:01:05.000Z" }),
  row({ type: "duration", session_id: "s1", seconds: 120, page: "studio:grid", created_at: "2026-07-20T10:02:00.000Z" }),
  row({ type: "duration", session_id: "s1", seconds: 60, page: "studio:editor", created_at: "2026-07-20T10:03:00.000Z" }),
  row({ type: "export", session_id: "s1", format: "otf", bucket: "6-20", created_at: "2026-07-20T10:03:10.000Z" }),

  row({ session_id: "s2", device: "mobile", referrer: "www.google.com", created_at: "2026-07-21T10:00:00.000Z" }),
  row({ type: "tool_use", session_id: "s2", format: "pen", page: "studio:free", pointer: "touch", created_at: "2026-07-21T10:00:10.000Z" }),
  row({ type: "duration", session_id: "s2", seconds: 8, page: "studio:free", created_at: "2026-07-21T10:00:20.000Z" }),

  row({ session_id: "s3", device: "desktop", referrer: "google.com", created_at: "2026-07-22T10:00:00.000Z" }),
  row({ type: "duration", session_id: "s3", seconds: 5, page: "studio:grid", created_at: "2026-07-22T10:00:10.000Z" }),

  row({ session_id: "s4", device: "desktop", created_at: "2026-07-23T10:00:00.000Z" }),
  row({ type: "tool_use", session_id: "s4", format: "brush", page: "studio:free", pointer: "pen", created_at: "2026-07-23T10:00:20.000Z" }),
  row({ type: "duration", session_id: "s4", seconds: 3000, page: "studio:free", created_at: "2026-07-23T11:00:00.000Z" }),
  row({ type: "export", session_id: "s4", format: "marketplace-publish", bucket: "60+", created_at: "2026-07-23T11:00:10.000Z" }),

  row({ created_at: "2026-07-19T10:00:00.000Z" }), // legacy, no session
  row({ type: "export", format: "marketplace-download", created_at: "2026-07-23T12:00:00.000Z" }), // server-side, no session
  row({ type: "charset", session_id: "s1", format: "latin-extended", bucket: "on", created_at: "2026-07-20T10:00:40.000Z" }),
  row({ type: "gate", session_id: "s3", format: "cloud-code", created_at: "2026-07-22T10:00:05.000Z" }),
  row({ type: "error", session_id: "s1", format: "export:otf", created_at: "2026-07-20T10:03:11.000Z" }),
  row({ type: "tour", session_id: "s1", format: "started", created_at: "2026-07-20T10:00:01.000Z" }),
  row({ type: "tour", session_id: "s1", format: "completed", created_at: "2026-07-20T10:00:45.000Z" }),
  row({ type: "tour", session_id: "s2", format: "started", created_at: "2026-07-21T09:00:01.000Z" }),
  row({ type: "tour", session_id: "s2", format: "skipped:3", created_at: "2026-07-21T09:00:10.000Z" }),
];

const filters = { from: "2026-07-18", to: "2026-07-24", device: null };
const o = computeOverview({ allRows: rows, prevAllRows: [], allTimeVisits: 999, filters });

eq("visits (pageviews incl. legacy)", o.visits, 5);
eq("funnel", o.funnel, { sessions: 4, drew: 3, exported: 2, published: 1 });
eq("activation 3/4", o.activation, 0.75);
// visit lengths: s1 180, s2 8, s3 5, s4 3000 -> sorted 5,8,180,3000 -> median idx2 = 180
eq("median visit = summed segments", o.medianVisitSeconds, 180);
eq("visits measured", o.sessionsMeasured, 4);
// time to first tool: s1 30, s2 10, s4 20 -> sorted 10,20,30 -> 20
eq("median time to first stroke", o.medianTimeToFirstTool, 20);
// 5s and 8s both land in "< 10s"; 180s in "1–5m"; 3000s in "> 30m".
eq("duration histogram", o.durationHistogram.map((b) => b.count), [2, 0, 1, 0, 1]);
eq(
  "source quality",
  o.sources,
  [
    { label: "Direct", sessions: 2, drew: 2, exported: 2 },
    { label: "google.com", sessions: 2, drew: 1, exported: 0 },
  ]
);
eq("direct/referred pageviews", [o.directCount, o.referredCount], [3, 2]);
eq("sessions coverage note", o.sessionsSince, "2026-07-20");
eq("bucket count = 7 days", o.buckets.length, 7);
eq("bucket totals", o.buckets.map((b) => b.total), [0, 1, 1, 1, 1, 1, 0]);

// Device segment: desktop = s1, s3, s4. The legacy pageview and the
// server-side download row must drop out, not be attributed to desktop.
const desktop = computeOverview({ allRows: rows, prevAllRows: [], allTimeVisits: 999, filters: { ...filters, device: "desktop" } });
// Publishing to the marketplace IS an export path, so s4 counts at both
// steps — which is also what keeps the funnel from widening downwards.
eq("desktop funnel", desktop.funnel, { sessions: 3, drew: 2, exported: 2, published: 1 });
eq("desktop drops legacy pageview", desktop.visits, 3);

const d = computeDetail({ allRows: rows, filters });
eq("tools ranked", d.tools.map((t) => [t.tool, t.total, t.undos]), [["pen", 2, 0], ["vector", 1, 1], ["brush", 1, 0]]);
eq("pen by view", d.tools.find((t) => t.tool === "pen")!.byView, { "studio:grid": 1, "studio:free": 1 });
eq("pointer mix", d.pointerMix, [{ label: "pen", count: 2 }, { label: "mouse", count: 1 }, { label: "touch", count: 1 }]);
eq("export sizes keep ordinal order", d.exportSizes.map((b) => b.count), [0, 0, 1, 0, 1]);
eq("exports incl. server-side download", d.exports.map((e) => e.label).sort(), ["marketplace-download", "marketplace-publish", "otf"]);
eq("charsets", d.charsets, [{ label: "latin-extended", on: 1, off: 0 }]);
eq("gates", d.gates, [{ label: "cloud-code", count: 1 }]);
eq("errors", d.errors, [{ label: "export:otf", count: 1 }]);
eq("tour started", d.tourStarted, 2);
eq("tour completed", d.tourCompleted, 1);
eq("tour skips", d.tourSkips, [{ label: "step 3", count: 1 }]);
eq("time by view sorted by total", d.timeByView.map((t) => [t.view, t.totalSeconds]), [
  ["studio:free", 3008],
  ["studio:grid", 125],
  ["studio:editor", 60],
]);

// An empty range must not throw or produce NaN.
const none = computeOverview({ allRows: [], prevAllRows: [], allTimeVisits: 0, filters });
eq("empty range activation", none.activation, null);
eq("empty range median", none.medianVisitSeconds, 0);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
