// Everything both /anneliese pages need to agree on: what "the selected
// range" means, what the device segment means, and how a link carries both
// from one page to the other. Split out of data.ts so the overview and the
// detail page can never drift into filtering by slightly different rules.

export type DateRange = { from: string; to: string }; // ISO "YYYY-MM-DD", inclusive
export type Filters = DateRange & { device: string | null };

export const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
] as const;

// The segment control. "tablet" is deliberately its own option rather than
// folded into mobile: on a drawing tool an iPad with a pencil is a different
// product from a phone, and telling those apart is half the point of asking.
export const DEVICES = ["desktop", "tablet", "mobile"] as const;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return isoDate(d);
}

export function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function resolveFilters(searchParams: { from?: string; to?: string; device?: string }): Filters {
  const today = isoDate(new Date());
  const device = DEVICES.includes(searchParams.device as (typeof DEVICES)[number]) ? searchParams.device! : null;
  if (searchParams.from && searchParams.to) {
    return { from: searchParams.from, to: searchParams.to, device };
  }
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 29); // "Last 30 days" is the default, inclusive of today
  return { from: isoDate(from), to: today, device };
}

// The equally long window immediately before the selected one — the only
// honest comparison for a "+18% vs. previous" delta. A 7-day range compares
// against the 7 days before it, not against "last week" as a calendar idea.
export function previousRange(range: DateRange): DateRange {
  const length = daysBetween(range.from, range.to);
  const to = new Date(`${range.from}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (length - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

// Filters survive every link on both pages — a date range that silently
// resets when you click through to the detail page would make the two pages
// disagree, which is the one thing a split dashboard must never do.
export function hrefWith(base: string, filters: Filters, override: Partial<Filters> = {}): string {
  const merged = { ...filters, ...override };
  const params = new URLSearchParams({ from: merged.from, to: merged.to });
  if (merged.device) params.set("device", merged.device);
  return `${base}?${params.toString()}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}m ${rest}s`;
  }
  // A tab left open for hours (a real thing this dashboard has seen — see
  // the "hours dragged the mean up" comment in aggregate.ts) used to come
  // out as e.g. "666m 40s", technically correct but nobody reads triple-
  // digit minutes at a glance. h/m/s past the hour mark instead.
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.round(seconds % 60);
  return `${hours}h ${minutes}m ${rest}s`;
}
