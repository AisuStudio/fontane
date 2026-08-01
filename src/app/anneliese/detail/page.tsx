import { getDetailData } from "../data";
import { resolveFilters, formatDuration } from "../filters";
import { BarTable, Empty, Ratio, Section, Shell } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// The other half of the split: not "is it growing" but "what do people build
// with it, and with which parts". Everything here is a decision input for
// what to work on next — which is why almost every table has a second column
// that qualifies the count rather than just ranking it.
export default async function AnnelieseDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; device?: string }>;
}) {
  const filters = resolveFilters(await searchParams);
  const stats = await getDetailData(filters);
  const views = stats.views.length ? stats.views : ["unlabelled"];

  return (
    <Shell filters={filters} active="detail">
      {!stats.ok && (
        <p style={{ color: "#5100ff", marginBottom: 24 }}>
          Storage isn&apos;t connected yet (Supabase env vars missing) — showing zeros.
        </p>
      )}

      <Section
        title="tools, by view"
        note="the same tool means different things in Grid and in the Editor; undo rate is the cheapest signal for whether it did what was expected"
        since={stats.toolViewSince}
      >
        {stats.tools.length === 0 ? (
          <Empty>no tool activity yet</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr style={{ opacity: 0.5, fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "0 0 6px", fontWeight: "normal" }}>tool</th>
                  {views.map((v) => (
                    <th key={v} style={{ padding: "0 0 6px 8px", fontWeight: "normal", textAlign: "right" }}>
                      {v.replace(/^studio:/, "")}
                    </th>
                  ))}
                  <th style={{ padding: "0 0 6px 12px", fontWeight: "normal", textAlign: "right" }}>total</th>
                  <th style={{ padding: "0 0 6px 12px", fontWeight: "normal", textAlign: "right" }}>undone</th>
                </tr>
              </thead>
              <tbody>
                {stats.tools.map((t) => (
                  <tr key={t.tool} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                    <td style={{ padding: "6px 0", fontSize: 13 }}>{t.tool}</td>
                    {views.map((v) => (
                      <td
                        key={v}
                        style={{ padding: "6px 0 6px 8px", textAlign: "right", fontSize: 13, opacity: t.byView[v] ? 1 : 0.25 }}
                      >
                        {t.byView[v] ?? 0}
                      </td>
                    ))}
                    <td style={{ padding: "6px 0 6px 12px", textAlign: "right", fontSize: 13 }}>{t.total}</td>
                    <td style={{ padding: "6px 0 6px 12px", textAlign: "right", fontSize: 13 }}>
                      <Ratio n={t.undos} of={t.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ opacity: 0.4, fontSize: 12, marginTop: 8 }}>
          {stats.totalUndos} undos in range, attributed to the tool that last reported a use — an approximation, not a
          per-action link
        </p>
      </Section>

      <Section
        title="what people draw with"
        note="pen vs. finger vs. mouse, per tool action — the number that decides whether pressure and stylus work pays off"
        since={stats.pointerSince}
      >
        {stats.pointerMix.length === 0 ? <Empty>no pointer data yet</Empty> : <BarTable rows={stats.pointerMix} />}
      </Section>

      <Section
        title="how much gets built before an export"
        note="glyphs with something in them at export time, in buckets — five letters or a typeface"
        since={stats.exportSizeSince}
      >
        {stats.exportSizes.every((b) => b.count === 0) ? (
          <Empty>no exports with a size recorded yet</Empty>
        ) : (
          <BarTable rows={stats.exportSizes} />
        )}
      </Section>

      <Section title="exports by format">
        {stats.exports.length === 0 ? <Empty>no exports yet</Empty> : <BarTable rows={stats.exports} />}
      </Section>

      <Section
        title="time spent, by view"
        note="visible time only; one segment per view, so a visit can appear in several rows — max is the single longest segment recorded for that view, not a sum across sessions"
      >
        {stats.timeByView.length === 0 ? (
          <Empty>no per-view timing yet</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ opacity: 0.5, fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "0 0 6px", fontWeight: "normal" }}>view</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>median</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>max</th>
                <th style={{ padding: "0 0 6px", fontWeight: "normal", textAlign: "right" }}>segments</th>
              </tr>
            </thead>
            <tbody>
              {stats.timeByView.map((row) => (
                <tr key={row.view} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                  <td style={{ padding: "8px 0" }}>{row.view}</td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>{formatDuration(row.medianSeconds)}</td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>{formatDuration(row.maxSeconds)}</td>
                  <td style={{ padding: "8px 0", textAlign: "right", opacity: 0.6 }}>{row.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="character sets switched on"
        note="which glyph coverage people reach for beyond the default — a want, not just a use"
      >
        {stats.charsets.length === 0 ? (
          <Empty>nobody has changed the character sets in this range</Empty>
        ) : (
          <BarTable
            rows={stats.charsets.map((c) => ({ label: c.label, count: c.on }))}
            extra={(r) => {
              const off = stats.charsets.find((c) => c.label === r.label)?.off ?? 0;
              return off ? `${off}× switched off again` : "";
            }}
          />
        )}
      </Section>

      <Section
        title="marketplace browse → download"
        note="aggregate ratio, not a per-visitor funnel — downloads are logged server-side and carry no session"
        since={stats.viewsTrackedSince}
      >
        <p style={{ fontSize: 13 }}>
          {stats.marketplaceViews} views, {stats.marketplaceDownloads} downloads{" "}
          <span style={{ opacity: 0.6 }}>
            (<Ratio n={stats.marketplaceDownloads} of={stats.marketplaceViews} />)
          </span>
        </p>
      </Section>

      <Section
        title="walls and failures"
        note="a rejected invite code is someone trying to sign up without one; an export error is a use that didn't work"
      >
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(2, 1fr)" }}>
          <div>
            <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8 }}>gates hit</div>
            {stats.gates.length === 0 ? <Empty>none</Empty> : <BarTable rows={stats.gates} />}
          </div>
          <div>
            <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8 }}>errors</div>
            {stats.errors.length === 0 ? <Empty>none</Empty> : <BarTable rows={stats.errors} />}
          </div>
        </div>
      </Section>

      <Section
        title="accounts"
        note="signup = a new account created (invite code accepted); login = a returning sign-in — cross-device cloud save is the only thing an account unlocks"
        since={stats.authSince}
      >
        {stats.authEvents.length === 0 ? <Empty>none yet</Empty> : <BarTable rows={stats.authEvents} />}
      </Section>

      <Section
        title="guided tour"
        note="does the first-time tour help, or do people bail — started vs completed, and the step skips cluster at"
      >
        {stats.tourStarted === 0 ? (
          <Empty>none</Empty>
        ) : (
          <>
            <p style={{ fontSize: 13, marginBottom: stats.tourSkips.length > 0 ? 16 : 0 }}>
              {stats.tourStarted} started, {stats.tourCompleted} completed{" "}
              <span style={{ opacity: 0.6 }}>
                (<Ratio n={stats.tourCompleted} of={stats.tourStarted} />)
              </span>
            </p>
            {stats.tourSkips.length > 0 && (
              <div>
                <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8 }}>skipped at</div>
                <BarTable rows={stats.tourSkips} />
              </div>
            )}
          </>
        )}
      </Section>
    </Shell>
  );
}
