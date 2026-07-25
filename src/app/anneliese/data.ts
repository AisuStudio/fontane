import { getSupabase } from "@/lib/supabase";
import { previousRange, type DateRange, type Filters } from "./filters";
import { computeDetail, computeOverview, type EventRow } from "./aggregate";

// Loading only. Every number is computed in aggregate.ts from the rows this
// file hands it — which is what lets the arithmetic be checked without a
// database, and what keeps "which rows" and "what they mean" from tangling.

export type { Bucket, SourceSlice, Ranked, ToolRow } from "./aggregate";

const COLUMNS = "type, session_id, seconds, format, referrer, country, device, language, page, pointer, bucket, created_at";

// PostgREST caps a plain select at 1000 rows (Supabase's default max-rows) —
// silently. Every number on this page would have started quietly
// understating itself the moment a range held more than 1000 events, which
// is exactly what beta traffic is for. Page through instead of trusting one
// request to have returned everything.
const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000; // a backstop against an accidental unbounded loop, not an expectation

async function fetchRows(range: DateRange): Promise<EventRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const fromTs = `${range.from}T00:00:00.000Z`;
  const toTs = `${range.to}T23:59:59.999Z`;
  const rows: EventRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("fontane_events")
      .select(COLUMNS)
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }) // stable paging: same-timestamp rows must not shuffle between pages
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as EventRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  return rows;
}

// Shape-compatible zeros for both pages, used when Supabase isn't configured
// or a query fails — the page renders its own "not connected" note rather
// than crashing, exactly as before.
function emptyRows(filters: Filters) {
  return { allRows: [] as EventRow[], prevAllRows: [] as EventRow[], allTimeVisits: 0, filters };
}

export async function getOverviewData(filters: Filters) {
  const supabase = getSupabase();
  if (!supabase) return { ...computeOverview(emptyRows(filters)), ok: false as const };
  try {
    const [allRows, prevAllRows, { count }] = await Promise.all([
      fetchRows(filters),
      fetchRows(previousRange(filters)),
      // All-time, deliberately NOT scoped to the range — the one number on
      // the page that's meant to just keep growing, rather than reset every
      // time the date filter changes.
      supabase.from("fontane_events").select("*", { count: "exact", head: true }).eq("type", "pageview"),
    ]);
    return computeOverview({ allRows, prevAllRows, allTimeVisits: count ?? 0, filters });
  } catch {
    return { ...computeOverview(emptyRows(filters)), ok: false as const };
  }
}

export async function getDetailData(filters: Filters) {
  if (!getSupabase()) return { ...computeDetail({ allRows: [], filters }), ok: false as const };
  try {
    return computeDetail({ allRows: await fetchRows(filters), filters });
  } catch {
    return { ...computeDetail({ allRows: [], filters }), ok: false as const };
  }
}
