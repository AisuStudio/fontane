import { getOverviewData } from "./data";
import { resolveFilters, formatDuration } from "./filters";
import StackedBarChart from "./StackedBarChart";
import { BarTable, Empty, Funnel, Ratio, Section, Shell, StatTile } from "./ui";

export const dynamic = "force-dynamic";
// Deliberately not in any nav/sitemap and not disallowed in robots.txt either
// (a Disallow would just draw attention to it) — reachable only by URL.
export const metadata = { robots: { index: false, follow: false } };

// The overview answers three questions and no others: is it growing, where
// do people come from, and where do they stop. Everything about WHAT gets
// built with the tool lives on /anneliese/detail — the two pages are split
// by question, not by depth, because they get read at different moments:
// this one at a glance, that one when deciding what to build next.
export default async function AnneliesePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; device?: string }>;
}) {
  const filters = resolveFilters(await searchParams);
  const stats = await getOverviewData(filters);

  return (
    <Shell filters={filters} active="overview">
      {!stats.ok && (
        <p style={{ color: "#5100ff", marginBottom: 24 }}>
          Storage isn&apos;t connected yet (Supabase env vars missing) — showing zeros.
        </p>
      )}

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <StatTile
          value={String(stats.visits)}
          label="visits in range"
          current={stats.visits}
          previous={stats.prevVisits}
          sparkline={stats.sparkline}
          note={`${stats.allTimeVisits} all time`}
        />
        <StatTile
          value={stats.activation == null ? "—" : `${Math.round(stats.activation * 100)}%`}
          label="sessions that drew something"
          current={stats.activation ?? 0}
          previous={stats.prevActivation ?? 0}
          note={
            stats.medianTimeToFirstTool == null
              ? "no tool use measured yet"
              : `${formatDuration(stats.medianTimeToFirstTool)} to first stroke (median)`
          }
        />
        <StatTile
          value={stats.medianVisitSeconds ? formatDuration(stats.medianVisitSeconds) : "—"}
          label="median visit (visible time)"
          current={stats.medianVisitSeconds}
          previous={stats.prevMedianVisitSeconds}
          note={`${stats.sessionsMeasured} sessions measured`}
        />
      </div>

      <Section
        title="where visits stop"
        note="a session is one page load; the visits tile above counts pageviews, so a visit that opens the marketplace too is two of those and one of these. Sessions, not events, so one determined person can't inflate a step. The steps aren't strictly nested: a project loaded from a file can be exported without drawing anything first, so a lower step can be wider than the one above it"
        since={stats.sessionsSince}
      >
        <Funnel
          steps={[
            { label: "sessions", value: stats.funnel.sessions },
            { label: "drew something", value: stats.funnel.drew },
            { label: "exported", value: stats.funnel.exported, note: "otf / fff / json / svg / cloud" },
            { label: "published to marketplace", value: stats.funnel.published },
          ]}
        />
      </Section>

      {/* Ranges longer than a month bucket by month, so the heading has to
          follow what buildBuckets() actually decided rather than assert a
          granularity of its own. */}
      <Section
        title={`visitors per ${(stats.buckets[0]?.label.length ?? 0) > 6 ? "month" : "day"}, by source`}
        note={`${stats.directCount} direct / ${stats.referredCount} referred`}
      >
        <StackedBarChart buckets={stats.buckets} legend={stats.legend} />
      </Section>

      <Section
        title="which sources bring people who actually build"
        note="arriving and doing are different things — this is the column that separates them"
        since={stats.sessionsSince}
      >
        {stats.sources.length === 0 ? (
          <Empty>no sessions with a source yet</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ opacity: 0.5, fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "0 0 6px", fontWeight: "normal" }}>source</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>sessions</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>drew</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>exported</th>
              </tr>
            </thead>
            <tbody>
              {stats.sources.map((s) => (
                <tr key={s.label} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                  <td style={{ padding: "6px 0", fontSize: 13 }}>{s.label}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontSize: 13 }}>{s.sessions}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontSize: 13 }}>
                    <Ratio n={s.drew} of={s.sessions} />
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontSize: 13 }}>
                    <Ratio n={s.exported} of={s.sessions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="how long sessions actually last"
        note="a bounce and a working session are two populations; one median between them describes neither"
        since={stats.sessionsSince}
      >
        {stats.sessionsMeasured === 0 ? (
          <Empty>no measured sessions in this range</Empty>
        ) : (
          <BarTable rows={stats.durationHistogram} extra={(r) => <Ratio n={r.count} of={stats.sessionsMeasured} />} />
        )}
      </Section>

      <Section title="visitors by country, device, language">
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(3, 1fr)" }}>
          {(
            [
              ["country", stats.topCountries],
              ["device", stats.topDevices],
              ["language", stats.topLanguages],
            ] as const
          ).map(([label, entries]) => (
            <div key={label}>
              <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8, textTransform: "capitalize" }}>{label}</div>
              {entries.length === 0 ? <Empty>no data yet</Empty> : <BarTable rows={entries} />}
            </div>
          ))}
        </div>
      </Section>
    </Shell>
  );
}
