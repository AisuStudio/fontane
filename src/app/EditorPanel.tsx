"use client";

import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { layoutText, type LaidOutEntry } from "@/lib/layoutText";
import { outlineToPath, type PathCommand } from "@/lib/contour";
import type { Glyph } from "@/lib/glyphs";
import type { Stroke, StrokePoint } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";
import type { StrokeSettings } from "@/lib/settings";

type Props = {
  glyphs: Glyph[];
  strokes: Stroke[];
  metrics: Metrics;
  settings: StrokeSettings;
  text: string;
  onTextChange: (text: string) => void;
  fontSize: number;
};

const INK_COLOR = "#1f1934"; // blueberry, same as untagged/default ink everywhere else
const PLACEHOLDER_COLOR = "#9e9c95"; // hazelnut — muted, matches --color-muted
const LINE_GAP = 24; // breathing room between stacked lines, beyond each line's own ascender/descender
// bbox-fallback glyphs (Write-tagged, no Grid calibration) can reach up to
// 40px above y=0 by construction (layoutText.ts's TARGET_CAP_HEIGHT=140 minus
// its BASELINE_Y=100) — without this, the very first line's ascenders get
// clipped by the canvas's own top edge, since every later line is already
// protected by the previous line's height+gap but the first has nothing
// above it.
const TOP_PADDING = 48;

export const DEFAULT_EDITOR_FONT_SIZE_PT = 105; // keeps layoutText's built-in 140px cap-height as the out-of-the-box look
const PT_TO_PX = 96 / 72; // standard CSS/print conversion at 96dpi
const REFERENCE_CAP_HEIGHT_PX = 140; // layoutText.ts's internal TARGET_CAP_HEIGHT — the size every glyph is already normalized to before this final size scale is applied

// Small local duplicates of page.tsx's canvas helpers (applyPath/fillOutline/
// outlineFor) — same duplication convention already used between page.tsx
// and GridCell.tsx, since each owns its own <canvas> and there's no shared
// canvas-rendering module in this codebase.
function optionsFor(settings: StrokeSettings) {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
  };
}

function outlineFor(points: StrokePoint[], settings: StrokeSettings): [number, number][] {
  return getStroke(points, optionsFor(settings)) as [number, number][];
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

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][]) {
  if (outline.length < 3) return;
  ctx.beginPath();
  applyPath(ctx, outlineToPath(outline));
  ctx.fillStyle = INK_COLOR;
  ctx.fill();
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
  metrics,
  settings,
  text,
  onTextChange,
  fontSize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, rect.width, rect.height);

      const paragraphs = text.split("\n");
      // Fit within the actual box, in layoutText's own (pre-sizeFactor) unit
      // space — a small right margin so glyphs never touch the very edge.
      const RIGHT_MARGIN = 16;
      const maxLineWidth = Math.max(rect.width / sizeFactor - RIGHT_MARGIN / sizeFactor, 50);

      // Chars left to walk through before hitting the caret's global text
      // offset — decremented per visual line (wrapped sub-lines consume no
      // extra character, only the paragraph's own trailing "\n" does) until
      // it lands within the current visual line's own entries.
      let remainingToCaret = caretIndex;
      let caretDrawn = false;
      let caretX = 0;
      let caretTop = 0;
      let caretBottom = 0;

      let lineY = TOP_PADDING;
      for (const paragraph of paragraphs) {
        const layout = layoutText(paragraph, glyphs, strokes, metrics);
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

          for (const entry of lineEntries) {
            if (entry.kind !== "glyph") continue;
            for (const strokePoints of entry.strokePointSets) {
              // Each glyph's raw pen points, transformed by layoutText's own
              // per-glyph offset/scale (the same Grid-bearing-aware or
              // bbox-fallback calibration Animate mode already uses),
              // re-based to this wrapped line's own x=0 origin (subtracting
              // where this line started in the unwrapped paragraph) plus
              // this line's running Y offset, then uniformly rescaled by
              // the user's chosen point size — applied last so it grows/
              // shrinks glyph size AND inter-glyph/inter-line spacing
              // together, not just the letterforms in place. Pressure
              // carried straight through untouched, so the composed text
              // still renders with real perfect-freehand thickness
              // variation, not a flattened skeleton.
              const transformed: StrokePoint[] = strokePoints.map((p) => [
                (p[0] * entry.scale + entry.offsetX - lineStartX) * sizeFactor,
                (p[1] * entry.scale + entry.offsetY + lineY) * sizeFactor,
                p[2],
              ]);
              fillOutline(ctx!, outlineFor(transformed, effectiveSettingsFor(settings, sizeFactor)));
            }
          }

          if (!caretDrawn && remainingToCaret <= lineEntries.length) {
            let x = 0;
            for (let i = 0; i < remainingToCaret && i < lineEntries.length; i++) x += lineEntries[i].advanceWidth;
            caretX = x * sizeFactor;
            caretTop = lineY * sizeFactor;
            caretBottom = (lineY + layout.height) * sizeFactor;
            caretDrawn = true;
          }
          remainingToCaret -= lineEntries.length;
          lineY += layout.height + LINE_GAP;
        }

        remainingToCaret -= 1; // the paragraph's own trailing "\n"
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

      // The hidden <textarea>'s own placeholder never renders (it's fully
      // transparent), so draw one directly — plain system font, not the
      // handwritten glyphs, same as any other empty-state hint.
      if (text === "") {
        ctx!.save();
        ctx!.font = "14px \"Public Sans\", system-ui, sans-serif";
        ctx!.fillStyle = PLACEHOLDER_COLOR;
        ctx!.fillText("Type using your tagged glyphs…", 0, TOP_PADDING - 8);
        ctx!.restore();
      }
    }

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [text, glyphs, strokes, metrics, settings, sizeFactor, caretIndex, caretVisible]);

  return (
    <div className={styles.editorPanel}>
      <div className={styles.editorCanvasWrap} onClick={() => textareaRef.current?.focus()}>
        <canvas ref={canvasRef} className={styles.editorCanvas} />
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
