"use client";

import { useState } from "react";
import type { Bucket } from "./data";
import { formatDuration } from "./filters";

// Fixed pixel-like coordinate space, scaled uniformly to the container via
// CSS width:100%/height:auto (no preserveAspectRatio="none" — that stretches
// every mark AND every text label non-uniformly the moment the rendered
// aspect ratio differs from the viewBox's, which is exactly what happened
// here the first time around: garbled, unreadable axis labels).
const VIEW_W = 900;
const VIEW_H = 220;
const AXIS_LABEL_H = 24; // reserved for the x-axis date labels
// Reserved strip on the right for the median-seconds axis text ("3m 20s",
// "0s") — without it, the last bucket sits flush against VIEW_W and its own
// value label collides with the axis text sitting at the same edge. The
// left (count) axis never needed this: its labels sit above their own
// gridline with the plot's natural empty space to their right.
const RIGHT_AXIS_W = 40;
const BAR_MAX_W = 24;
const SEGMENT_GAP = 2; // surface gap between stacked segments
const AXIS_COLOR = "#c3c2b7"; // baseline/axis, one step off the cream surface
const GRID_COLOR = "#d9d7cd"; // hairline gridline, recessive
const MUTED = "#89877f"; // axis/label ink
// Not reused from the source palette (blue/violet/aqua/yellow/green above) —
// this is a different kind of series (a line, not a stacked segment) and
// needs to read as visually distinct at a glance, not like a sixth source.
// Median is the solid, heavier line ("typical"); max is the same hue,
// lighter and dashed ("the one big day"), rather than an unrelated color —
// they're two readings of the same underlying thing, not two metrics.
const MEDIAN_LINE_COLOR = "#c2410c"; // burnt orange
const MAX_LINE_COLOR = "#ea9a6f"; // lighter burnt orange

type Tooltip = { x: number; y: number; label: string; source: string; count: number };
type SecondsTooltip = { x: number; y: number; label: string; seconds: number; samples: number; kind: "median" | "max" };

export default function StackedBarChart({ buckets, legend }: { buckets: Bucket[]; legend: { label: string; color: string }[] }) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [secondsTooltip, setSecondsTooltip] = useState<SecondsTooltip | null>(null);

  if (buckets.length === 0) {
    return <p style={{ opacity: 0.6 }}>no traffic in this range</p>;
  }

  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  // Round the axis ceiling up to a clean step so gridline labels are round
  // numbers, not the raw max.
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxTotal)));
  const niceMax = Math.ceil(maxTotal / magnitude) * magnitude || 1;
  const gridSteps = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  const plotH = VIEW_H - AXIS_LABEL_H;
  const plotW = VIEW_W - RIGHT_AXIS_W;
  const slotW = plotW / buckets.length;
  const barW = Math.min(BAR_MAX_W, slotW * 0.7);

  // Skip x labels if there are too many buckets to fit without collision.
  const labelStride = Math.ceil(buckets.length / 14);

  // Median/max-seconds lines, own right-hand scale — independent of niceMax
  // above, since seconds and visit counts have nothing to do with each
  // other's range. Ceiling comes from maxSeconds (always >= medianSeconds),
  // so the max line's peaks never clip. Only buckets with at least one
  // duration sample get a point; each line breaks (not dips to zero)
  // across a bucket with none, so a quiet day reads as "no data" rather
  // than "nobody stayed."
  const secondsCeiling = Math.max(1, ...buckets.map((b) => b.maxSeconds));
  const secMagnitude = Math.pow(10, Math.floor(Math.log10(secondsCeiling)));
  const niceMaxSeconds = Math.ceil(secondsCeiling / secMagnitude) * secMagnitude || 1;

  function runsFor(pick: (b: Bucket) => number) {
    const points = buckets.map((b, i) => ({
      x: i * slotW + slotW / 2,
      y: b.durationSamples > 0 ? plotH - (pick(b) / niceMaxSeconds) * plotH : null,
      bucket: b,
    }));
    // Consecutive runs of real points only — a null (no-data bucket) always
    // ends the current run rather than being skipped-over, so the line
    // never silently bridges a gap it has no data for.
    const runs: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    for (const p of points) {
      if (p.y == null) {
        if (current.length) runs.push(current);
        current = [];
      } else {
        current.push({ x: p.x, y: p.y });
      }
    }
    if (current.length) runs.push(current);
    return { points, runs };
  }

  const medianSeries = runsFor((b) => b.medianSeconds);
  const maxSeries = runsFor((b) => b.maxSeconds);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        role="img"
        aria-label="Pageviews over time, stacked by traffic source"
      >
        {gridSteps.map((v) => {
          const y = plotH - (v / niceMax) * plotH;
          return (
            <g key={v}>
              <line x1={0} x2={plotW} y1={y} y2={y} stroke={GRID_COLOR} strokeWidth={1} />
              <text x={0} y={y - 4} fontSize={11} fill={MUTED} fontFamily="monospace">
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        <line x1={0} x2={plotW} y1={plotH} y2={plotH} stroke={AXIS_COLOR} strokeWidth={1} />

        {buckets.map((bucket, i) => {
          const barX = i * slotW + (slotW - barW) / 2;
          let cursorY = plotH;
          const segments = bucket.sources.map((s, si) => {
            const h = (s.count / niceMax) * plotH;
            const y = cursorY - h;
            cursorY = y - SEGMENT_GAP;
            const isTop = si === bucket.sources.length - 1;
            return { ...s, x: barX, y, w: barW, h: Math.max(h, 0), isTop };
          });
          return (
            <g key={bucket.label + i}>
              {segments.map((seg, si) => (
                <rect
                  key={si}
                  x={seg.x}
                  y={seg.y}
                  width={seg.w}
                  height={seg.h}
                  fill={seg.color}
                  rx={seg.isTop ? 3 : 0}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  onMouseEnter={() => setTooltip({ x: seg.x + seg.w / 2, y: seg.y, label: bucket.label, source: seg.label, count: seg.count })}
                  onFocus={() => setTooltip({ x: seg.x + seg.w / 2, y: seg.y, label: bucket.label, source: seg.label, count: seg.count })}
                  onMouseLeave={() => setTooltip(null)}
                  onBlur={() => setTooltip(null)}
                />
              ))}
              {bucket.total > 0 && (
                <text x={barX + barW / 2} y={cursorY - 4} fontSize={10} fill={MUTED} textAnchor="middle" fontFamily="monospace">
                  {bucket.total}
                </text>
              )}
              {i % labelStride === 0 && (
                <text x={barX + barW / 2} y={plotH + 16} fontSize={10} fill={MUTED} textAnchor="middle" fontFamily="monospace">
                  {bucket.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Right-hand axis for the median/max-seconds lines — its own
            scale, on purpose: 0 always sits on the same baseline as the
            left axis's 0, but the ceiling means something completely
            different (seconds, not visits), so no gridlines are shared
            between the two. */}
        <text x={VIEW_W} y={12} fontSize={11} fill={MEDIAN_LINE_COLOR} textAnchor="end" fontFamily="monospace">
          {formatDuration(niceMaxSeconds)}
        </text>
        <text x={VIEW_W} y={plotH - 4} fontSize={11} fill={MEDIAN_LINE_COLOR} textAnchor="end" fontFamily="monospace">
          0s
        </text>

        {maxSeries.runs.map((run, ri) => (
          <polyline
            key={ri}
            points={run.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={MAX_LINE_COLOR}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ))}
        {maxSeries.points.map(
          (p, i) =>
            p.y != null && (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3}
                fill={MAX_LINE_COLOR}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                onMouseEnter={() =>
                  setSecondsTooltip({ x: p.x, y: p.y!, label: p.bucket.label, seconds: p.bucket.maxSeconds, samples: p.bucket.durationSamples, kind: "max" })
                }
                onFocus={() =>
                  setSecondsTooltip({ x: p.x, y: p.y!, label: p.bucket.label, seconds: p.bucket.maxSeconds, samples: p.bucket.durationSamples, kind: "max" })
                }
                onMouseLeave={() => setSecondsTooltip(null)}
                onBlur={() => setSecondsTooltip(null)}
              />
            )
        )}

        {medianSeries.runs.map((run, ri) => (
          <polyline
            key={ri}
            points={run.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={MEDIAN_LINE_COLOR}
            strokeWidth={2}
          />
        ))}
        {medianSeries.points.map(
          (p, i) =>
            p.y != null && (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill={MEDIAN_LINE_COLOR}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                onMouseEnter={() =>
                  setSecondsTooltip({ x: p.x, y: p.y!, label: p.bucket.label, seconds: p.bucket.medianSeconds, samples: p.bucket.durationSamples, kind: "median" })
                }
                onFocus={() =>
                  setSecondsTooltip({ x: p.x, y: p.y!, label: p.bucket.label, seconds: p.bucket.medianSeconds, samples: p.bucket.durationSamples, kind: "median" })
                }
                onMouseLeave={() => setSecondsTooltip(null)}
                onBlur={() => setSecondsTooltip(null)}
              />
            )
        )}
      </svg>

      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: `${(tooltip.x / VIEW_W) * 100}%`,
            top: `${(tooltip.y / VIEW_H) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "#1f1934",
            color: "#eae8e0",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            marginTop: -6,
          }}
        >
          <strong>{tooltip.count}</strong> {tooltip.source} — {tooltip.label}
        </div>
      )}

      {secondsTooltip && (
        <div
          style={{
            position: "absolute",
            left: `${(secondsTooltip.x / VIEW_W) * 100}%`,
            top: `${(secondsTooltip.y / VIEW_H) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "#1f1934",
            color: "#eae8e0",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            marginTop: -6,
          }}
        >
          <strong>{formatDuration(secondsTooltip.seconds)}</strong> {secondsTooltip.kind} — {secondsTooltip.label}{" "}
          <span style={{ opacity: 0.7 }}>
            ({secondsTooltip.samples} sample{secondsTooltip.samples === 1 ? "" : "s"})
          </span>
        </div>
      )}

      {(legend.length > 0 || buckets.some((b) => b.durationSamples > 0)) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, fontSize: 13 }}>
          {legend.map((entry) => (
            <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, background: entry.color, borderRadius: 2, display: "inline-block" }} />
              {entry.label}
            </div>
          ))}
          {buckets.some((b) => b.durationSamples > 0) && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 2, background: MEDIAN_LINE_COLOR, display: "inline-block" }} />
                median seconds/day (right axis)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 2,
                    backgroundImage: `repeating-linear-gradient(90deg, ${MAX_LINE_COLOR} 0 3px, transparent 3px 5px)`,
                    display: "inline-block",
                  }}
                />
                longest visit/day — the quiet-hour days the median hides
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
