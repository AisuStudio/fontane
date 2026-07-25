"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { layoutText } from "@/lib/layoutText";
import { outlineToPath, type PathCommand } from "@/lib/contour";
import { loadGlyphs, type Glyph } from "@/lib/glyphs";
import { loadStrokes, type Stroke, type StrokeKind, type StrokePoint } from "@/lib/strokes";
import { calligraphyOutline, type Nib } from "@/lib/calligraphy";
import { loadMetrics, type Metrics } from "@/lib/metrics";
import { loadSettings, type StrokeSettings } from "@/lib/settings";

const INK_COLOR = "#1f1934";
const BG_COLOR = "#eae8e0";
// Mirrors layoutText.ts's internal BASELINE_Y (not exported there) — the
// baseline sits 100 pre-scale px below each line's top; the slnt shear
// below pivots around it so letters lean from the baseline, like the real
// slnt axis in font-build/build_vf.py.
const LINE_BASELINE_Y = 100;
const TOP_PADDING = 48; // same reasoning as EditorPanel: bbox-fallback ascenders reach above y=0
const LINE_GAP = 24;
const LEFT_MARGIN = 32;
const MAX_SIZE_FACTOR = 1.15; // upper display-size bound — draw() auto-fits below this so long text never clips

// wght 100..400..900 → pen-size factor 0.45..1..1.9, the same mapping the
// generated variable font uses (font-build/gen-vf-masters.mjs MASTERS).
function wghtFactor(wght: number): number {
  return wght <= 400 ? 0.45 + (wght - 100) * (0.55 / 300) : 1 + (wght - 400) * (0.9 / 500);
}

// Local duplicates of the app's canvas helpers — same convention as
// EditorPanel.tsx/GridCell.tsx (each canvas owner keeps its own copies).
function optionsFor(settings: StrokeSettings) {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
  };
}

function nibFor(settings: StrokeSettings): Nib {
  return { size: settings.nibSize, ratio: settings.nibRatio, angle: settings.nibAngle };
}

// Both widths scale on the same factor, so the wght axis reads as weight for
// nib-drawn glyphs too — a stroke only ever uses one of the two.
function effectiveSettingsFor(settings: StrokeSettings, scale: number): StrokeSettings {
  return scale === 1 ? settings : { ...settings, size: settings.size * scale, nibSize: settings.nibSize * scale };
}

function outlineFor(points: StrokePoint[], settings: StrokeSettings, kind?: StrokeKind): [number, number][] {
  if (kind === "calligraphy") return calligraphyOutline(points, nibFor(settings));
  return getStroke(points, optionsFor(settings)) as [number, number][];
}

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][]) {
  const commands = outlineToPath(outline);
  if (commands.length === 0) return;
  ctx.beginPath();
  applyPath(ctx, commands);
  ctx.fill();
}

export default function VfLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Server render + first client render both show the bare shell — the
  // studio state only exists in localStorage, so rendering it before mount
  // would hydration-mismatch (the same pattern the main app's loaders
  // guard against with their typeof-window defaults).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [text, setText] = useState("lolo ool");
  const [wght, setWght] = useState(400);
  const [wdth, setWdth] = useState(100);
  const [slnt, setSlnt] = useState(0);
  const [breathe, setBreathe] = useState(false);

  // Loaded once from the same localStorage the studio writes — read-only
  // here, so the lab can never corrupt drawing state.
  const [glyphs] = useState<Glyph[]>(() => loadGlyphs());
  const [strokes] = useState<Stroke[]>(() => loadStrokes());
  const [metrics] = useState<Metrics>(() => loadMetrics());
  const [settings] = useState<StrokeSettings>(() => loadSettings());

  const draw = useCallback(
    (wghtNow: number, wdthNow: number, slntNow: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      type Line = { y: number; height: number; glyphSets: { points: StrokePoint[]; kind?: StrokeKind }[] };
      const lines: Line[] = [];
      let lineY = TOP_PADDING;
      let maxLineWidth = 0;
      for (const paragraph of text.split("\n")) {
        const layout = layoutText(paragraph, glyphs, strokes, metrics, false);
        const glyphSets: { points: StrokePoint[]; kind?: StrokeKind }[] = [];
        for (const entry of layout.entries) {
          if (entry.kind !== "glyph") continue;
          for (const set of entry.strokeSets) {
            glyphSets.push({
              points: set.points.map((p) => [
                p[0] * entry.scale + entry.offsetX,
                p[1] * entry.scale + entry.offsetY,
                p[2],
              ]),
              kind: set.kind,
            });
          }
        }
        lines.push({ y: lineY, height: layout.height, glyphSets });
        maxLineWidth = Math.max(maxLineWidth, layout.width);
        lineY += layout.height + LINE_GAP;
      }

      const dpr = window.devicePixelRatio || 1;
      // Guard against measuring mid-layout (hydration recovery, hidden tab):
      // a collapsed parent would otherwise bake a sliver-width canvas.
      const cssWidth = Math.max(canvas.parentElement?.clientWidth ?? 900, 320);
      // Fit the widest line into the canvas — including the wdth stretch, so
      // pushing Buchstabenbreite to 135 never clips off the right edge.
      const wdthFit = Math.max(wdthNow / 100, 1);
      const SIZE_FACTOR = Math.min(
        MAX_SIZE_FACTOR,
        maxLineWidth > 0 ? (cssWidth - 2 * LEFT_MARGIN) / (maxLineWidth * wdthFit) : MAX_SIZE_FACTOR
      );
      const cssHeight = Math.max((lineY - LINE_GAP + 40) * SIZE_FACTOR, 260);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = INK_COLOR;

      const wdthF = wdthNow / 100;
      const shear = Math.tan((slntNow * Math.PI) / 180);
      const penSettings = effectiveSettingsFor(settings, SIZE_FACTOR * wghtFactor(wghtNow));

      for (const line of lines) {
        const baseY = (line.y + LINE_BASELINE_Y) * SIZE_FACTOR;
        ctx.save();
        // Order matters: shear around the line's own baseline first, then
        // stretch x from the left margin — mirrors how build_vf.py derives
        // the wdth/slnt masters from the default outlines.
        ctx.translate(LEFT_MARGIN, baseY);
        ctx.transform(wdthF, 0, -shear, 1, 0, 0);
        ctx.translate(-LEFT_MARGIN, -baseY);
        for (const set of line.glyphSets) {
          const transformed: StrokePoint[] = set.points.map((p) => [
            (p[0] + LEFT_MARGIN) * SIZE_FACTOR,
            (p[1] + line.y) * SIZE_FACTOR,
            p[2],
          ]);
          fillOutline(ctx, outlineFor(transformed, penSettings, set.kind));
        }
        ctx.restore();
      }
    },
    [text, glyphs, strokes, metrics, settings]
  );

  // Static redraw whenever an axis or the text changes (sliders drive this
  // directly; the breathe loop below bypasses it with its own rAF). mounted
  // is a real dependency: the canvas only exists after the mount flip, and
  // nothing else changes in that render, so without it the first draw never
  // fires.
  useEffect(() => {
    if (mounted && !breathe) draw(wght, wdth, slnt);
  }, [mounted, draw, wght, wdth, slnt, breathe]);

  // "Atmen": oscillate the wght axis — the same interpolation a CSS
  // font-variation-settings keyframe would drive on the real VF file.
  useEffect(() => {
    if (!breathe) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const value = Math.round(400 + 280 * Math.sin(t * 1.8));
      setWght(value);
      draw(value, wdth, slnt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [breathe, draw, wdth, slnt]);

  const taggedCount = glyphs.filter((g) => g.kind === "base").length;

  if (!mounted) {
    return <div style={{ minHeight: "100vh", background: BG_COLOR }} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: BG_COLOR, color: INK_COLOR, fontFamily: "monospace" }}>
      <div style={{ padding: "20px 28px 0" }}>
        <h1 style={{ fontSize: 14, margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>vf lab</h1>
        <p style={{ fontSize: 12, margin: "4px 0 0", opacity: 0.6 }}>
          Animate × Variable auf deinen eigenen Glyphen — Strichbreite echt re-gerendert, Breite/Neigung affin. Nicht verlinkt.
        </p>
      </div>

      {taggedCount === 0 ? (
        <p style={{ padding: 28, fontSize: 13 }}>
          Noch keine getaggten Glyphen — erst im Studio zeichnen &amp; taggen, dann hier spielen.
        </p>
      ) : (
        <>
          <div style={{ padding: "16px 28px" }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              style={{
                width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13,
                padding: "8px 10px", border: `1px solid ${INK_COLOR}33`, borderRadius: 4,
                background: "transparent", color: "inherit", outline: "none",
              }}
            />
          </div>
          <div style={{ padding: "0 28px" }}>
            <canvas ref={canvasRef} style={{ display: "block" }} />
          </div>
          <div
            style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20,
              padding: "20px 28px 28px", borderTop: `1px solid ${INK_COLOR}26`, marginTop: 16,
            }}
          >
            {(
              [
                ["Strichbreite (wght)", wght, 100, 900, 1, setWght, breathe],
                ["Buchstabenbreite (wdth)", wdth, 70, 135, 1, setWdth, false],
                ["Neigung (slnt)", slnt, -12, 12, 0.5, setSlnt, false],
              ] as const
            ).map(([label, value, min, max, step, setter, disabled]) => (
              <label key={label} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                <span style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                  {label} <span>{value}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => setter(Number(e.target.value))}
                  style={{ accentColor: "#5100ff" }}
                />
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}>
              <input type="checkbox" checked={breathe} onChange={(e) => setBreathe(e.target.checked)} />
              Atmen (wght animiert)
            </label>
          </div>
        </>
      )}
    </div>
  );
}
