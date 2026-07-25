"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { layoutText, type LaidOutEntry } from "@/lib/layoutText";
import { outlineToPath, outlineToSharpPath, flattenVectorShape, type PathCommand } from "@/lib/contour";
import { applyBrush, type BrushOptions, type BrushOutput } from "@/lib/brush";
import type { VectorShape } from "@/lib/vectorShapes";
import type { Glyph } from "@/lib/glyphs";
import type { Stroke, StrokePoint } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";
import type { StrokeSettings } from "@/lib/settings";

type Props = {
  glyphs: Glyph[];
  strokes: Stroke[];
  // Vector-tool shapes, needed alongside strokes since Grid's Vector tool can
  // produce a glyph made of nothing else.
  vectorShapes: VectorShape[];
  metrics: Metrics;
  settings: StrokeSettings;
  text: string;
  onTextChange: (text: string) => void;
  fontSize: number;
  useLigatures: boolean;
};

const INK_COLOR = "#1f1934"; // blueberry, same as untagged/default ink everywhere else
const LINE_GAP = 24; // breathing room between stacked lines, beyond each line's own ascender/descender
// bbox-fallback glyphs (Write-tagged, no Grid calibration) can reach up to
// 40px above y=0 by construction (layoutText.ts's TARGET_CAP_HEIGHT=140 minus
// its BASELINE_Y=100) — without this, the very first line's ascenders get
// clipped by the canvas's own top edge, since every later line is already
// protected by the previous line's height+gap but the first has nothing
// above it.
const TOP_PADDING = 48;

// The Editor's own placeholder line — deliberately NOT the Marketplace's
// SAMPLE_TEXT: that one stays short and letters-only so published fonts stay
// comparable side by side on the browse cards, while this one is a full
// pangram with digits, capitals and punctuation, so drawing against it
// surfaces every glyph still missing from your own set.
export const EDITOR_SAMPLE_TEXT = "Really, the 206 quick brown foxes jump over 57 dazy logs!";

export const DEFAULT_EDITOR_FONT_SIZE_PT = 105; // keeps layoutText's built-in 140px cap-height as the out-of-the-box look
const PT_TO_PX = 96 / 72; // standard CSS/print conversion at 96dpi
const REFERENCE_CAP_HEIGHT_PX = 140; // layoutText.ts's internal TARGET_CAP_HEIGHT — the size every glyph is already normalized to before this final size scale is applied

// Small local duplicates of page.tsx's canvas helpers (applyPath/fillOutline/
// outlineFor) — same duplication convention already used between page.tsx
// and GridCell.tsx, since each owns its own <canvas> and there's no shared
// canvas-rendering module in this codebase.
function optionsFor(settings: StrokeSettings): BrushOptions {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
    brush: settings.brush,
  };
}

// Seeded by the originating stroke id (layoutText carries them through for
// exactly this) so the preview's scatter pattern is the one the export will
// produce, not a second roll of the same dice.
function outlineFor(points: StrokePoint[], settings: StrokeSettings, seedKey: string): BrushOutput {
  return applyBrush(points, optionsFor(settings), seedKey);
}

// The composed glyph geometry below is uniformly rescaled by sizeFactor (see
// the transformed-points map in draw()) — without this, stroke thickness
// stays pinned to the global settings.size regardless of the chosen point
// size, so text looks razor-thin at large sizes and blobby at small ones.
function effectiveSettingsFor(settings: StrokeSettings, scale: number): StrokeSettings {
  return scale === 1 ? settings : { ...settings, size: settings.size * scale };
}

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

// A glyph's stroke paired with the id of the stroke it came from — the
// brush's deterministic seed (see applyBrush), carried this far so the
// preview and the export scatter identically.
type BrushedStrokeSet = { points: StrokePoint[]; seed: string };

function fillOutline(ctx: CanvasRenderingContext2D, out: BrushOutput) {
  if (out.polygons.length === 0) return;
  ctx.beginPath();
  for (const polygon of out.polygons) {
    if (polygon.length < 3) continue;
    applyPath(ctx, out.smooth ? outlineToPath(polygon) : outlineToSharpPath(polygon));
  }
  ctx.fillStyle = INK_COLOR;
  ctx.fill();
}

// Every ring in ONE path, then a single fill — unlike fillOutline above, which
// is per-outline. unionOutlines/subtractOutlines hand back a glyph's rings
// with the winding directions that make nonzero fill cut the counters out
// (see contour.ts); filling each ring on its own would discard exactly that
// relationship and paint an "o" as a solid disc.
function fillRings(ctx: CanvasRenderingContext2D, rings: [number, number][][]) {
  const usable = rings.filter((ring) => ring.length >= 3);
  if (usable.length === 0) return;
  ctx.beginPath();
  for (const ring of usable) applyPath(ctx, outlineToPath(ring));
  ctx.fillStyle = INK_COLOR;
  // Even-odd, so a Vector shape drawn inside another reads as a counter — the
  // B/O/A case. The drawing canvases and compileDocument() apply the same rule
  // (see contour.ts's xorOutlines); this preview would otherwise show a solid
  // blob where the exported font has a hole. Unlike the canvases the fill
  // stays ink here: the Editor previews the finished letter, not the
  // work-in-progress affordances.
  ctx.fill("evenodd");
}

// Most entries (space/missing, and any glyph without ligature substitution)
// stand for exactly one raw text character; a ligature-substituted glyph
// entry stands for however many characters useLigatures folded into it (see
// layoutText.ts). The caret math below has to walk entries in char-index
// space, not entry-index space, so it needs this rather than entries.length.
function entryCharLength(entry: LaidOutEntry): number {
  return entry.kind === "glyph" ? entry.charLength : 1;
}

type WrappedLine = { entries: LaidOutEntry[]; startIndex: number };

// Soft-wraps one paragraph's already-laid-out entries (one entry per
// character, see layoutText.ts) into visual lines that fit maxWidth —
// greedy, breaking after the last space seen so far; if a single word is
// wider than the whole box, hard-breaks mid-word rather than overflowing
// forever. startIndex is this line's first entry's index in the original
// (unwrapped) entries array — entry.offsetX was computed against that whole
// paragraph's running cursor, so the caller needs it to re-base each
// wrapped line back to its own x=0 origin. Every entry ends up in exactly
// one line, in order, so a caller can also reconstruct character offsets by
// summing line lengths.
function wrapEntries(entries: LaidOutEntry[], maxWidth: number): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let current: LaidOutEntry[] = [];
  let currentStart = 0;
  let currentWidth = 0;
  let lastSpaceAt = -1; // index within `current`, or -1 if no break candidate yet

  for (const entry of entries) {
    if (current.length > 0 && currentWidth + entry.advanceWidth > maxWidth) {
      if (lastSpaceAt !== -1) {
        lines.push({ entries: current.slice(0, lastSpaceAt + 1), startIndex: currentStart });
        currentStart += lastSpaceAt + 1;
        current = current.slice(lastSpaceAt + 1);
      } else {
        lines.push({ entries: current, startIndex: currentStart });
        currentStart += current.length;
        current = [];
      }
      currentWidth = current.reduce((sum, e) => sum + e.advanceWidth, 0);
      lastSpaceAt = -1;
    }
    current.push(entry);
    currentWidth += entry.advanceWidth;
    if (entry.kind === "space") lastSpaceAt = current.length - 1;
  }
  lines.push({ entries: current, startIndex: currentStart });
  return lines;
}

export default function EditorPanel({
  glyphs,
  strokes,
  vectorShapes,
  metrics,
  settings,
  text,
  onTextChange,
  fontSize,
  useLigatures,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The scroll viewport around the canvas — its own box size only ever
  // changes from window/layout resizing (overflow-y:auto means the canvas
  // growing taller never inflates it), so it's what the ResizeObserver
  // watches and what supplies the "at least this tall" floor for a short
  // composition.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Real text input — invisible, absolutely stacked over the canvas (see
  // .editorHiddenInput) — so typing/caret/selection/IME/copy-paste all stay
  // native instead of reimplemented. Only its position (caretIndex) is read
  // out to draw our own caret bar at the matching spot in the handwritten
  // preview.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [caretIndex, setCaretIndex] = useState(0);
  const [caretVisible, setCaretVisible] = useState(true);
  const sizeFactor = (fontSize * PT_TO_PX) / REFERENCE_CAP_HEIGHT_PX;

  function syncCaret(e: { currentTarget: HTMLTextAreaElement }) {
    setCaretIndex(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
  }

  // Blink like a native caret, but never mid-blink right after the user just
  // moved it or typed — every position/text change restarts the cycle
  // visible.
  useEffect(() => {
    setCaretVisible(true);
    const id = setInterval(() => setCaretVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [caretIndex, text]);

  // Phase 1 (per the plan): read-only composition/preview — type using
  // already-tagged glyphs, no direct drawing/erasing/reshaping here yet.
  // (Missing-glyph detection and the font-size control both live in
  // page.tsx's dark settings panel now, not here.)

  useEffect(() => {
    const canvas = canvasRef.current;
    const scrollEl = scrollRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !scrollEl || !ctx) return;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      // Width only — the canvas's own height is what we're about to compute
      // from content, so read it from the scroll viewport (fixed by layout)
      // rather than the canvas's current (stale) bounding rect.
      const cssWidth = scrollEl!.clientWidth;
      const RIGHT_MARGIN = 16;
      const maxLineWidth = Math.max(cssWidth / sizeFactor - RIGHT_MARGIN / sizeFactor, 50);
      const LEFT_MARGIN = 8; // same pre-sizeFactor unit space as TOP_PADDING
      const BOTTOM_MARGIN = 24;

      // ---- Pass 1: lay out every line's geometry, but don't draw yet ----
      // A glyph's own left bearing/overshoot can put its leftmost point
      // below this line's x=0 origin (layoutText.ts's offsetX is computed
      // against the whole paragraph's cursor, not clamped to stay
      // non-negative) — draw it as-is and it's simply off the left edge of
      // the canvas, permanently, with nothing to scroll to reveal it. So
      // each line's points are collected first, its own minX measured, and
      // only then drawn with just enough rightward shift to clear that
      // line's own worst offender — never a flat guessed margin, since the
      // overshoot varies per glyph and per font size.
      type LineGeometry = {
        y: number;
        height: number;
        minX: number;
        glyphInk: { strokeSets: BrushedStrokeSet[]; shapeRings: [number, number][][] }[];
      };
      const lines: LineGeometry[] = [];

      let remainingToCaret = caretIndex;
      let caretDrawn = false;
      let caretLineIndex = -1;
      let caretCharX = 0;

      let lineY = TOP_PADDING;
      // Nothing typed yet — compose the same specimen pangram the
      // Marketplace preview uses instead of a plain gray hint, so the
      // canvas shows the font actually working the instant a glyph or two
      // is tagged. caretIndex still comes from the real (empty) textarea,
      // so the caret lands at the very start of this preview, signaling
      // "type to replace it" rather than looking like already-typed text.
      const displayText = text || EDITOR_SAMPLE_TEXT;
      const paragraphs = displayText.split("\n");
      for (const paragraph of paragraphs) {
        const layout = layoutText(paragraph, glyphs, strokes, metrics, useLigatures, vectorShapes);
        const wrappedLines = wrapEntries(layout.entries, maxLineWidth);

        // Each entry's offsetX was computed against this cumulative cursor
        // (see layoutText.ts) — recomputed here (not re-derived from
        // offsetX) so re-basing a wrapped line is a plain subtraction below.
        const cumulativeXAtStart: number[] = [];
        let acc = 0;
        for (const entry of layout.entries) {
          cumulativeXAtStart.push(acc);
          acc += entry.advanceWidth;
        }

        for (const { entries: lineEntries, startIndex } of wrappedLines) {
          const lineStartX = cumulativeXAtStart[startIndex] ?? 0;
          let minX = 0;
          // Grouped per glyph rather than flattened into one stroke list:
          // a glyph carrying Vector-tool shapes has to be composited on its
          // own (its shapes punch holes in ITS strokes, not in a neighbor's),
          // which needs the boundary kept intact.
          const glyphInk: { strokeSets: BrushedStrokeSet[]; shapeRings: [number, number][][] }[] = [];

          for (const entry of lineEntries) {
            if (entry.kind !== "glyph") continue;
            const rebaseX = (x: number) => {
              const rx = x * entry.scale + entry.offsetX - lineStartX;
              if (rx < minX) minX = rx;
              return rx;
            };
            const strokeSets = entry.strokePointSets.map((strokePoints, i) => ({
              // The stroke's own id rides along as the brush seed — see
              // LaidOutEntry.strokeIds.
              seed: entry.strokeIds[i] ?? `${entry.glyph.name}:${i}`,
              points: strokePoints.map(
                (p): StrokePoint => [rebaseX(p[0]), p[1] * entry.scale + entry.offsetY, p[2]]
              ),
            }));
            const shapeRings = entry.vectorShapes.map(
              (shape): [number, number][] =>
                flattenVectorShape(shape).map(([x, y]) => [rebaseX(x), y * entry.scale + entry.offsetY])
            );
            glyphInk.push({ strokeSets, shapeRings });
          }

          const lineCharLength = lineEntries.reduce((sum, e) => sum + entryCharLength(e), 0);

          if (!caretDrawn && remainingToCaret <= lineCharLength) {
            // Walk entries (not raw char indices) so a ligature's merged
            // glyph is never split mid-entry — a caret position that falls
            // inside one snaps to its left edge instead.
            let x = 0;
            let charsWalked = 0;
            for (const entry of lineEntries) {
              const len = entryCharLength(entry);
              if (charsWalked + len > remainingToCaret) break;
              x += entry.advanceWidth;
              charsWalked += len;
            }
            caretCharX = x;
            caretLineIndex = lines.length;
            caretDrawn = true;
          }
          remainingToCaret -= lineCharLength;

          lines.push({ y: lineY, height: layout.height, minX, glyphInk });
          lineY += layout.height + LINE_GAP;
        }

        remainingToCaret -= 1; // the paragraph's own trailing "\n"
      }

      // ---- Size the canvas to fit every line, never less than the visible box ----
      const contentHeight = Math.max(lineY - LINE_GAP + BOTTOM_MARGIN, TOP_PADDING) * sizeFactor;
      const cssHeight = Math.max(contentHeight, scrollEl!.clientHeight);

      canvas!.style.height = `${cssHeight}px`;
      canvas!.width = cssWidth * dpr;
      canvas!.height = cssHeight * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, cssWidth, cssHeight);

      // ---- Pass 2: draw, shifting each line right just enough to clear its own leftmost extent ----
      let caretX = 0;
      let caretTop = 0;
      let caretBottom = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const shiftX = LEFT_MARGIN - Math.min(0, line.minX);
        const penSettings = effectiveSettingsFor(settings, sizeFactor);
        const place = (x: number, y: number): [number, number] => [
          (x + shiftX) * sizeFactor,
          (y + line.y) * sizeFactor,
        ];
        for (const { strokeSets, shapeRings } of line.glyphInk) {
          for (const { points, seed } of strokeSets) {
            const transformed: StrokePoint[] = points.map((p) => {
              const [x, y] = place(p[0], p[1]);
              return [x, y, p[2]];
            });
            fillOutline(ctx!, outlineFor(transformed, penSettings, seed));
          }

          if (shapeRings.length === 0) continue;
          const placedRings = shapeRings.map((ring) => ring.map(([x, y]) => place(x, y)));

          if (strokeSets.length === 0) {
            // Vector-only glyph (Grid's Vector tool can produce one): the
            // shapes ARE the letter, so they just fill.
            fillRings(ctx!, placedRings);
            continue;
          }
          // Strokes plus shapes: the shapes punch holes, exactly like the Free
          // and Grid canvases do it live. Deliberately NOT routed through
          // union/subtractOutlines the way compileDocument does at export
          // time — feeding a pen stroke's annular outline into a polygon
          // union collapses the letter's own counter (an "o" came out a solid
          // disc), and destination-out keeps every counter intact. The one
          // cost is that a shape reaching outside its glyph's advance would
          // also erase into a neighbor, same as in Free.
          ctx!.save();
          ctx!.globalCompositeOperation = "destination-out";
          fillRings(ctx!, placedRings);
          ctx!.restore();
        }
        if (i === caretLineIndex) {
          caretX = (caretCharX + shiftX) * sizeFactor;
          caretTop = line.y * sizeFactor;
          caretBottom = (line.y + line.height) * sizeFactor;
        }
      }

      if (caretDrawn && caretVisible) {
        ctx!.save();
        ctx!.strokeStyle = INK_COLOR;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.moveTo(caretX + 0.5, caretTop);
        ctx!.lineTo(caretX + 0.5, caretBottom);
        ctx!.stroke();
        ctx!.restore();
      }

    }

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(scrollEl);
    return () => resizeObserver.disconnect();
  }, [text, glyphs, strokes, metrics, settings, sizeFactor, caretIndex, caretVisible, useLigatures]);

  return (
    <div className={styles.editorPanel}>
      <div className={styles.editorCanvasWrap} onClick={() => textareaRef.current?.focus()}>
        <div className={styles.editorCanvasScroll} ref={scrollRef}>
          <canvas ref={canvasRef} className={styles.editorCanvas} />
        </div>
        <textarea
          ref={textareaRef}
          className={styles.editorHiddenInput}
          value={text}
          onChange={(e) => {
            onTextChange(e.target.value);
            syncCaret(e);
          }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={syncCaret}
          placeholder=""
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  );
}
