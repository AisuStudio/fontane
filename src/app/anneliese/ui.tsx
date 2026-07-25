import { DEVICES, PRESETS, hrefWith, isoDaysAgo, isoDate, type Filters } from "./filters";

// Shared presentation for both /anneliese pages. Server components
// throughout — the whole dashboard stays plain HTML that re-renders on a GET,
// same as the date filter always has.

const INK = "#1f1934";
const CREAM = "#eae8e0";
const ACCENT = "#d8ff01";
const RULE = "rgba(31,25,52,0.15)";
// Magnitude bars are one neutral fill, never the categorical palette: within
// a single table the bar encodes "how much", and giving each row its own hue
// would imply a grouping that isn't there.
const BAR = "rgba(31,25,52,0.16)";
const UP = "#008300";
const DOWN = "#b02a1e";

// Below this many observations a percentage is noise dressed as a fact, so
// it's shown greyed with its n rather than as a confident number. Every
// ratio on both pages goes through the same gate.
const MIN_N = 20;

export function Section({
  title,
  note,
  since,
  children,
}: {
  title: string;
  note?: string;
  since?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section style={{ margin: "40px 0 0" }}>
      <h2 style={{ fontSize: 16, marginBottom: 4, opacity: 0.6 }}>{title}</h2>
      {(note || since) && (
        <p style={{ opacity: 0.45, fontSize: 12, marginBottom: 12 }}>
          {note}
          {note && since ? " — " : ""}
          {/* Every metric here started existing at some point. A section
              whose data begins mid-range reads as a collapse unless it says
              so, which is how "0 views, 7 downloads" once happened. */}
          {since && `only recorded since ${since}`}
        </p>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ opacity: 0.6, fontSize: 13 }}>{children}</p>;
}

// A number is only readable next to what it was: "31s" says nothing, "31s,
// −18% vs. the 30 days before" says everything. Direction is carried by an
// arrow as well as by color, so it survives both CVD and a grayscale print.
function Delta({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  if (!previous) return <span style={{ opacity: 0.35, fontSize: 12 }}>no prior period</span>;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span style={{ opacity: 0.4, fontSize: 12 }}>= vs. prev.</span>;
  const better = invert ? change < 0 : change > 0;
  return (
    <span style={{ color: better ? UP : DOWN, fontSize: 12 }}>
      {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}% vs. prev.
    </span>
  );
}

// Shape only, no axis: it exists to say "steady / spiking / dying" at a
// glance next to the number it belongs to. Anything that needs reading
// precisely is in the chart below it.
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${24 - (v / max) * 22}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="24" style={{ display: "block", marginTop: 6 }}>
      <polyline points={points} fill="none" stroke={INK} strokeOpacity={0.45} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTile({
  value,
  label,
  current,
  previous,
  invert,
  sparkline,
  note,
}: {
  value: string;
  label: string;
  current?: number | null;
  previous?: number | null;
  invert?: boolean;
  sparkline?: number[];
  note?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 36, lineHeight: 1.1 }}>{value}</div>
      <div style={{ opacity: 0.6, fontSize: 13, margin: "2px 0 4px" }}>{label}</div>
      {current != null && previous != null && <Delta current={current} previous={previous} invert={invert} />}
      {note && <div style={{ opacity: 0.4, fontSize: 11, marginTop: 2 }}>{note}</div>}
      {sparkline && <Sparkline values={sparkline} />}
    </div>
  );
}

// A ranked table where the magnitude is visible without reading the numbers
// — the bar is drawn behind the label rather than in its own column, so the
// list stays as compact as the plain tables it replaces.
export function BarTable({
  rows,
  extra,
}: {
  rows: { label: string; count: number }[];
  extra?: (row: { label: string; count: number }) => React.ReactNode;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} style={{ borderTop: `1px solid ${RULE}` }}>
            <td style={{ padding: "6px 0", fontSize: 13, position: "relative" }}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 4,
                  bottom: 4,
                  width: `${(row.count / max) * 100}%`,
                  background: BAR,
                  borderRadius: 2,
                }}
              />
              <span style={{ position: "relative", paddingLeft: 4 }}>{row.label}</span>
            </td>
            {extra && <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, opacity: 0.6 }}>{extra(row)}</td>}
            <td style={{ padding: "6px 0", textAlign: "right", fontSize: 13, width: 60 }}>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A percentage that refuses to pretend. Under MIN_N it still shows, but
// greyed and with its denominator attached — the alternative (hiding it) is
// worse on a site this size, where every early section is under n.
export function Ratio({ n, of, digits = 0 }: { n: number; of: number; digits?: number }) {
  if (!of) return <span style={{ opacity: 0.35 }}>—</span>;
  const pct = (n / of) * 100;
  const weak = of < MIN_N;
  return (
    <span style={{ opacity: weak ? 0.45 : 1 }} title={weak ? `only ${of} observations` : undefined}>
      {pct.toFixed(digits)}%{weak ? ` (n=${of})` : ""}
    </span>
  );
}

// The one shape that shows where people stop instead of how many arrived.
// Each step is drawn to scale against the first, and labelled with both its
// share of the whole and its share of the step above — the second is what
// tells you which single step is the leak.
export function Funnel({ steps }: { steps: { label: string; value: number; note?: string }[] }) {
  const first = steps[0]?.value ?? 0;
  if (!first) return <Empty>no sessions in this range yet</Empty>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {steps.map((step, i) => {
        const prev = i === 0 ? step.value : steps[i - 1].value;
        return (
          <div key={step.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
              <span>
                {step.label} <strong>{step.value}</strong>
                {step.note && <span style={{ opacity: 0.4, fontSize: 11 }}> {step.note}</span>}
              </span>
              <span style={{ opacity: 0.6, fontSize: 12 }}>
                {Math.round((step.value / first) * 100)}% of sessions
                {i > 0 && prev > 0 && ` · ${Math.round((step.value / prev) * 100)}% of step above`}
              </span>
            </div>
            <div style={{ height: 14, background: "rgba(31,25,52,0.08)", borderRadius: 2 }}>
              <div style={{ width: `${(step.value / first) * 100}%`, height: "100%", background: INK, opacity: 0.55, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        padding: "4px 10px",
        borderRadius: 4,
        textDecoration: "none",
        color: INK,
        background: active ? ACCENT : "transparent",
        border: "1px solid rgba(31,25,52,0.2)",
      }}
    >
      {children}
    </a>
  );
}

// Page chrome: title, the two-page nav, and the filters — in that order,
// above everything they scope. Both pages share this so a range or segment
// chosen on one is still in force on the other; two dashboard pages
// disagreeing about what they're showing would be worse than one crowded one.
export function Shell({
  filters,
  active,
  children,
}: {
  filters: Filters;
  active: "overview" | "detail";
  children: React.ReactNode;
}) {
  const today = isoDate(new Date());
  return (
    <div
      style={{
        minHeight: "100vh",
        background: CREAM,
        color: INK,
        fontFamily: "monospace",
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 760, width: "100%" }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>anneliese</h1>
        <p style={{ opacity: 0.6, marginBottom: 20, fontSize: 14 }}>Fontane.Studio — mini analytics, no login required.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, fontSize: 13 }}>
          <FilterChip href={hrefWith("/anneliese", filters)} active={active === "overview"}>
            overview
          </FilterChip>
          <FilterChip href={hrefWith("/anneliese/detail", filters)} active={active === "detail"}>
            product detail
          </FilterChip>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
          {PRESETS.map((preset) => {
            const presetFrom = isoDaysAgo(preset.days);
            return (
              <FilterChip
                key={preset.id}
                href={hrefWith(`/anneliese${active === "detail" ? "/detail" : ""}`, filters, { from: presetFrom, to: today })}
                active={filters.from === presetFrom && filters.to === today}
              >
                {preset.label}
              </FilterChip>
            );
          })}
        </div>

        {/* The segment control. It can only work through sessions (device
            lives on the pageview row, a tool use has none), so selecting one
            drops events from before session_id existed — each section says
            so rather than quietly renormalising. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
          <span style={{ opacity: 0.5 }}>device:</span>
          <FilterChip
            href={hrefWith(`/anneliese${active === "detail" ? "/detail" : ""}`, filters, { device: null })}
            active={!filters.device}
          >
            all
          </FilterChip>
          {DEVICES.map((device) => (
            <FilterChip
              key={device}
              href={hrefWith(`/anneliese${active === "detail" ? "/detail" : ""}`, filters, { device })}
              active={filters.device === device}
            >
              {device}
            </FilterChip>
          ))}
        </div>

        <form style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
          <input type="date" name="from" defaultValue={filters.from} max={today} style={{ font: "inherit" }} />
          <span style={{ opacity: 0.6 }}>to</span>
          <input type="date" name="to" defaultValue={filters.to} max={today} style={{ font: "inherit" }} />
          {filters.device && <input type="hidden" name="device" value={filters.device} />}
          <button type="submit" style={{ font: "inherit", padding: "4px 10px", cursor: "pointer" }}>
            go
          </button>
        </form>
        <p style={{ opacity: 0.4, fontSize: 12, marginBottom: 24 }}>
          {filters.from} – {filters.to}
          {filters.device && ` · ${filters.device} only (sessions with a device, so nothing from before sessions existed)`}
        </p>

        {children}
      </div>
    </div>
  );
}
