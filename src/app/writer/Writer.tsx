"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyBrush } from "@/lib/brush";
import { outlineToPath, outlineToSharpPath, type PathCommand } from "@/lib/contour";
import type { Stroke, StrokePoint } from "@/lib/strokes";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { CHARACTER_SETS, DEFAULT_CHARACTER_SET_IDS } from "@/lib/charsets";
import MarketplaceNav from "../marketplace/MarketplaceNav";

// How many not-yet-covered characters go on the line at once — still "a few
// words" pacing (see the /writer plan), just driven by the real character
// sets now instead of five canned example phrases. Each queued character
// gets its own space around it, so to the segmentation code every batch
// looks like N one-letter "words" — segmentByGaps below doesn't change.
const BATCH_SIZE = 6;

function lettersOf(text: string) {
  return text.replace(/\s+/g, "").split("");
}

const PROGRESS_STORAGE_KEY = "fontane.writerProgress.v1";

// Coverage is tracked per character, independent of which sets happen to be
// selected right now — ticking Numbers off and back on shouldn't re-ask
// digits already covered in an earlier session. This is deliberately the
// only piece of /writer state that persists (see Dom: "man ist fein damit,
// dass nicht alles korrekt ist und man zwischen Editor und Writer hin und
// her wechseln kann") — correctness isn't tracked or required, only "was
// this character attempted at all."
function loadCoveredChars(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveCoveredChars(covered: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify([...covered]));
}

const CANVAS_W = 960;
const CANVAS_H = 240;
const REFERENCE_Y = 70; // where the printed model line sits
const BASELINE_Y = 170; // the plain ruled line the person writes on
const CAPTION_Y = BASELINE_Y + 26; // small hint directly under the writing line
const LEFT_MARGIN = 40;
const INK_COLOR = "#1a1a1a";
const GUIDE_LINE = "#d8d2c4";
const REFERENCE_COLOR = "#37352f";
// iA Writer's own duospace/mono editor font, if the person happens to have
// it installed (it ships with the app) — falls back to a plain monospace
// stack otherwise, which still reads as "typed reference text" rather than
// the earlier Georgia serif's more decorative, less copybook-like look.
const REFERENCE_FONT = "30px 'iA Writer Duospace', 'iA Writer Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const CAPTION_COLOR = "#a89f8c";
const CAPTION_TEXT = "please copy text here";

const MIN_PEN_SIZE = 2;
const MAX_PEN_SIZE = 60;
// Handwriting-scale letters read as much thicker than the same "size" value
// does on the main app's bigger glyph canvas — start thinner than
// DEFAULT_SETTINGS.size (20) so the first impression is a fine pen, not a
// marker.
const DEFAULT_PEN_SIZE = 8;
const DEFAULT_THINNING = DEFAULT_SETTINGS.thinning;

function strokeBoundsX(points: StrokePoint[]) {
  let xmin = Infinity;
  let xmax = -Infinity;
  for (const [x] of points) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
  }
  return { xmin, xmax, cx: (xmin + xmax) / 2 };
}

function strokeBoundsXY(points: StrokePoint[]) {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  return { xmin, xmax, ymin, ymax };
}

// No fixed slots anymore — the canvas is a plain line to copy the reference
// text onto, not a fill-in form. Segmentation instead picks the N-1 biggest
// x-gaps between strokes (N = known letter count) as letter boundaries and
// groups everything between two boundaries as one letter. Still zero
// recognition: it never looks at what a stroke *is*, only where the biggest
// gaps fall — the same trick real connected-component OCR pipelines use when
// the transcript is already known ("forced alignment"), just without any of
// the recognition machinery that name usually implies.
function segmentByGaps(strokes: Stroke[], letterCount: number): Stroke[][] {
  if (strokes.length === 0) return Array.from({ length: letterCount }, () => []);

  const sorted = [...strokes].sort((a, b) => strokeBoundsX(a.points).cx - strokeBoundsX(b.points).cx);
  const bounds = sorted.map((s) => strokeBoundsX(s.points));

  const gapCount = sorted.length - 1;
  const splitsNeeded = Math.min(letterCount - 1, gapCount);
  const gaps = Array.from({ length: gapCount }, (_, i) => ({
    afterIndex: i,
    size: bounds[i + 1].xmin - bounds[i].xmax,
  }));
  gaps.sort((a, b) => b.size - a.size);
  const splitAfter = gaps
    .slice(0, splitsNeeded)
    .map((g) => g.afterIndex)
    .sort((a, b) => a - b);

  const groups: Stroke[][] = [];
  let start = 0;
  for (const idx of splitAfter) {
    groups.push(sorted.slice(start, idx + 1));
    start = idx + 1;
  }
  groups.push(sorted.slice(start));

  // Fewer strokes than letters (writing cut short) — pad with empty groups
  // rather than crash; the result view just shows those as missing.
  while (groups.length < letterCount) groups.push([]);
  return groups.slice(0, letterCount);
}

type PenOptions = { size: number; mode: "mono" | "dynamic"; thinning: number };

function outlinePolygonsFor(points: StrokePoint[], seedKey: string, pen: PenOptions) {
  const out = applyBrush(
    points,
    {
      size: pen.size,
      thinning: pen.mode === "mono" ? 0 : pen.thinning,
      smoothing: DEFAULT_SETTINGS.smoothing,
      streamline: DEFAULT_SETTINGS.streamline,
      brush: DEFAULT_SETTINGS.brush,
    },
    seedKey
  );
  return out.polygons.map((p) => (out.smooth ? outlineToPath(p) : outlineToSharpPath(p)));
}

function paintCommands(ctx: CanvasRenderingContext2D, commandLists: PathCommand[][], color: string) {
  ctx.beginPath();
  for (const commands of commandLists) {
    for (const c of commands) {
      if (c.type === "M") ctx.moveTo(c.x, c.y);
      else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
      else if (c.type === "L") ctx.lineTo(c.x, c.y);
      else ctx.closePath();
    }
  }
  ctx.fillStyle = color;
  ctx.fill();
}

// The copybook model: the target phrase printed as normal text above a
// plain ruled line — something to read and copy by hand, not a row of boxes
// to fill in. This replaces the earlier per-letter tick-mark guide, which
// looked and behaved like a fill-in form even though it wasn't meant to.
function paintGuide(ctx: CanvasRenderingContext2D, text: string) {
  ctx.fillStyle = REFERENCE_COLOR;
  ctx.font = REFERENCE_FONT;
  ctx.textAlign = "left";
  ctx.fillText(text, LEFT_MARGIN, REFERENCE_Y);

  ctx.strokeStyle = GUIDE_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LEFT_MARGIN - 10, BASELINE_Y);
  ctx.lineTo(CANVAS_W - LEFT_MARGIN + 10, BASELINE_Y);
  ctx.stroke();

  ctx.fillStyle = CAPTION_COLOR;
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(CAPTION_TEXT, LEFT_MARGIN, CAPTION_Y);
}

// One small canvas per detected group, cropped to that group's own ink so
// mis-segmented (empty, or visually-wrong) groups are obvious at a glance —
// this prototype is meant to be eyeballed, not auto-scored, since only a
// human can judge whether the ink actually looks like the expected letter.
// The label starts pre-filled with the expected character (from the known
// coverage text) but is a plain editable text input, not a caption — lets
// the person correct a wrong segmentation, or repurpose it to name a
// ligature (e.g. typing "ti" over a cell that's actually two joined
// letters) ahead of the not-yet-built ligature-marking step. Only ever
// rendered as JSX text content (React escapes it) or drawn via canvas
// fillText (not executable) — see the /writer input-safety note. Real
// glyph-name sanitization (OpenType names are effectively ASCII-only, no
// spaces) belongs at the not-yet-built "commit as glyph" step, not here.
function ResultCell({
  char,
  strokes,
  pen,
  label,
  onLabelChange,
  occurrence,
  onMovePrev,
  onMoveNext,
}: {
  char: string;
  strokes: Stroke[];
  pen: PenOptions;
  label: string;
  onLabelChange: (next: string) => void;
  // 1 for the first cell with this label, 2+ for later ones sharing it — the
  // person never types ".alt1" themselves (that's type-engineer jargon, not
  // for a designer); they just label two cells the same plain letter, and
  // this is where that gets surfaced as "this becomes an alternate," ahead
  // of the not-yet-built step that actually calls nextAlternateName.
  occurrence: number;
  // Real cursive handwriting connects strokes across letter boundaries (an
  // "e" and the following "r" drawn as one continuous pen-down-to-pen-up
  // stroke) — the gap-based algorithm then puts that one stroke, and
  // whatever it visually contains, in the wrong cell entirely. Relabeling
  // alone can't fix that: the cell has the wrong ink, not just the wrong
  // caption. These nudge the actual boundary one stroke at a time instead of
  // requiring a full drag-and-drop rebuild. undefined when there's no
  // neighbor (first/last cell) or nothing to move.
  onMovePrev: (() => void) | undefined;
  onMoveNext: (() => void) | undefined;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const SIZE = 96;
  const PAD = 14;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (strokes.length === 0) return;

    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of strokes) {
      const b = strokeBoundsXY(s.points);
      xmin = Math.min(xmin, b.xmin);
      xmax = Math.max(xmax, b.xmax);
      ymin = Math.min(ymin, b.ymin);
      ymax = Math.max(ymax, b.ymax);
    }
    // Floor w/h at a multiple of the pen size, not just 1px — a dot-shaped
    // character (period, i-dot) has a near-zero bounding box, and scaling
    // that up to fill the thumbnail turns a small dot into a giant square.
    // Flooring by pen size keeps a dot looking like a dot, at roughly the
    // size it'd have next to a full-height letter in the same group.
    const w = Math.max(xmax - xmin, pen.size * 3, 1);
    const h = Math.max(ymax - ymin, pen.size * 3, 1);
    const scale = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);
    const offsetX = (SIZE - w * scale) / 2 - xmin * scale;
    const offsetY = (SIZE - h * scale) / 2 - ymin * scale;

    const transformed = strokes.map((s) => ({
      ...s,
      points: s.points.map(([x, y, p]) => [x * scale + offsetX, y * scale + offsetY, p] as StrokePoint),
    }));
    for (const s of transformed) {
      paintCommands(ctx, outlinePolygonsFor(s.points, s.id, { ...pen, size: pen.size * scale }), INK_COLOR);
    }
  }, [char, strokes, pen]);

  const missing = strokes.length === 0;
  const nudgeButtonStyle = (enabled: boolean): React.CSSProperties => ({
    fontSize: 11,
    lineHeight: 1,
    padding: "3px 6px",
    borderRadius: 4,
    border: "1px solid #ddd6c7",
    background: enabled ? "#fff" : "#f2efe8",
    color: enabled ? "#6b675c" : "#c9c3b4",
    cursor: enabled ? "pointer" : "default",
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: SIZE }}>
        <button
          type="button"
          title="Ersten Strich dieser Zelle zur vorherigen verschieben"
          onClick={onMovePrev}
          disabled={!onMovePrev}
          style={nudgeButtonStyle(!!onMovePrev)}
        >
          ← Strich
        </button>
        <button
          type="button"
          title="Letzten Strich dieser Zelle zur nächsten verschieben"
          onClick={onMoveNext}
          disabled={!onMoveNext}
          style={nudgeButtonStyle(!!onMoveNext)}
        >
          Strich →
        </button>
      </div>
      <canvas
        ref={ref}
        width={SIZE}
        height={SIZE}
        style={{
          border: `1px solid ${missing ? "#e3a0a0" : "#ddd6c7"}`,
          background: missing ? "#fdf2f2" : "#fff",
          borderRadius: 6,
        }}
      />
      <input
        type="text"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        maxLength={12}
        spellCheck={false}
        style={{
          width: 64,
          fontSize: 13,
          textAlign: "center",
          padding: "3px 4px",
          borderRadius: 4,
          border: "1px solid #ddd6c7",
          color: "#2a2822",
        }}
      />
      {missing && <span style={{ fontSize: 11, color: "#c98a8a" }}>leer</span>}
      {!missing && label !== char && <span style={{ fontSize: 11, color: "#a89f8c" }}>erwartet „{char}“</span>}
      {/* The real technical name — same convention as nextAlternateName in
          glyphs.ts (base.alt1, .alt2, ...) — shown as a small caption under
          a plain-letter input, not something the person has to type. Dom's
          framing: it's fine to show it here as a side-effect learning
          moment ("das lernt man dabei"), exactly as long as it's read-only
          and the input above never demands it. Same idea will apply to
          ligature names (f_i.liga) once cells can be merged into one. */}
      {!missing && occurrence > 1 && label.trim() && (
        <span style={{ fontSize: 11, color: "#7a6fb0" }}>
          {occurrence}. „{label}“ → {label.trim()}.alt{occurrence - 1}
        </span>
      )}
    </div>
  );
}

export default function Writer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const liveRef = useRef<StrokePoint[] | null>(null);
  const [phase, setPhase] = useState<"draw" | "result">("draw");
  const [groups, setGroups] = useState<Stroke[][]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [penSize, setPenSize] = useState(DEFAULT_PEN_SIZE);
  const [penMode, setPenMode] = useState<"mono" | "dynamic">("dynamic");
  const [thinning, setThinning] = useState(DEFAULT_THINNING);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>(DEFAULT_CHARACTER_SET_IDS);
  // Lazy initializer so this only touches localStorage once, client-side —
  // same pattern as loadGlyphs()/loadSettings() elsewhere in the app.
  const [coveredChars, setCoveredChars] = useState<Set<string>>(() => loadCoveredChars());
  // Free-text override of the auto-generated batch below — the built-in
  // CHARACTER_SETS are Latin/Cyrillic/Greek/etc. coverage lists, so a script
  // or language outside all of them (or just a specific pangram someone
  // wants to practice) had no way in before this. Empty means "use the
  // automatic character-set batch", same as it always has.
  const [customText, setCustomText] = useState("");

  const selectedChars = [...new Set(CHARACTER_SETS.filter((s) => selectedSetIds.includes(s.id)).flatMap((s) => s.chars))];
  const remainingChars = selectedChars.filter((c) => !coveredChars.has(c));
  const currentBatch = remainingChars.slice(0, BATCH_SIZE);
  const autoText = currentBatch.join(" ");
  const text = customText.trim() ? customText : autoText;
  const letters = lettersOf(text);
  // Custom text has nothing to do with CHARACTER_SETS coverage, so it's
  // never "done" — only the automatic batch can exhaust itself.
  const allDone = !customText.trim() && selectedChars.length > 0 && remainingChars.length === 0;
  const pen: PenOptions = { size: penSize, mode: penMode, thinning };
  const penRef = useRef(pen);
  penRef.current = pen;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    paintGuide(ctx, text);
    for (const stroke of strokesRef.current) {
      paintCommands(ctx, outlinePolygonsFor(stroke.points, stroke.id, penRef.current), INK_COLOR);
    }
    if (liveRef.current && liveRef.current.length > 1) {
      paintCommands(ctx, outlinePolygonsFor(liveRef.current, "live", penRef.current), INK_COLOR);
    }
  }, [text]);

  useEffect(() => {
    if (phase === "draw") redraw();
  }, [phase, redraw]);

  // Cmd/Ctrl+Z undoes the last stroke — the PC half of "Undo must work on
  // PC and tablets"; the on-screen Undo button below (next to Reset) is the
  // tablet half, since a stylus-only device has no Cmd/Ctrl key to press.
  // Ignored while a text input has focus (the custom-text field above) so
  // the browser's own native undo works there instead of being hijacked.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (phase !== "draw") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (strokesRef.current.length === 0) return;
        strokesRef.current = strokesRef.current.slice(0, -1);
        setStrokeCount(strokesRef.current.length);
        redraw();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, redraw]);

  // Pen settings affect already-committed strokes too (same "live setting,
  // not baked in" convention as the main app's strokeOutline) — redraw
  // whenever any of them change so what's on screen always matches the
  // controls.
  useEffect(() => {
    if (phase === "draw") redraw();
  }, [penSize, penMode, thinning, text, phase, redraw]);

  // The batch text is derived (character-set selection × coverage
  // progress), not something the person sets directly — this is what
  // notices it changed (a checkbox toggled, or the previous batch just got
  // marked covered) and clears stale ink/labels for the new one. Replaces
  // the old dropdown's explicit handleTextChange pairing.
  const prevTextRef = useRef(text);
  useEffect(() => {
    if (prevTextRef.current === text) return;
    prevTextRef.current = text;
    strokesRef.current = [];
    liveRef.current = null;
    setStrokeCount(0);
    setGroups([]);
    setLabels([]);
    setPhase("draw");
  }, [text]);

  function toPoint(e: React.PointerEvent<HTMLCanvasElement>): StrokePoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top, e.pressure > 0 ? e.pressure : 0.5];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    liveRef.current = [toPoint(e)];
    redraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!liveRef.current) return;
    liveRef.current.push(toPoint(e));
    redraw();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!liveRef.current) return;
    // >= 1, not > 1: a plain tap (a single point, no pointermove) is a real
    // stroke for dot-shaped characters — the period in "Der Hund bellt.",
    // an i-dot, a colon's two dots. perfect-freehand itself already handles
    // a lone point by drawing a small dot; the old `> 1` gate discarded taps
    // before they ever reached it, so punctuation silently vanished.
    if (liveRef.current.length >= 1) {
      strokesRef.current.push({
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        points: liveRef.current,
        createdAt: Date.now(),
      });
      setStrokeCount(strokesRef.current.length);
    }
    liveRef.current = null;
    redraw();
  }

  function handleEvaluate() {
    setGroups(segmentByGaps(strokesRef.current, letters.length));
    setLabels([...letters]);
    setPhase("result");
  }

  function handleReset() {
    strokesRef.current = [];
    liveRef.current = null;
    setStrokeCount(0);
    setGroups([]);
    setLabels([]);
    setPhase("draw");
  }

  // Removes the single most recent stroke — repeatable (each call just pops
  // the current last element), so it doubles as "undo everything" without
  // needing a separate history stack. Only meaningful in "draw": once
  // segmentByGaps has run, undoing a stroke wouldn't touch the groups/labels
  // already on screen, which would be confusing rather than useful.
  function handleUndo() {
    if (phase !== "draw" || strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
  }

  function handleLabelChange(index: number, next: string) {
    setLabels((prev) => prev.map((l, i) => (i === index ? next : l)));
  }

  // Moves one stroke across a cell boundary — "prev" takes this cell's
  // first stroke and appends it to the previous cell; "next" takes this
  // cell's last stroke and prepends it to the next cell. One stroke at a
  // time, not a full drag-and-drop rebuild — see the ResultCell comment on
  // why relabeling alone can't fix cursive strokes that span a letter
  // boundary.
  function handleMoveStroke(index: number, direction: "prev" | "next") {
    setGroups((prev) => {
      const next = prev.map((g) => [...g]);
      if (direction === "prev" && index > 0 && next[index].length > 0) {
        const [moved] = next[index].splice(0, 1);
        next[index - 1].push(moved);
      } else if (direction === "next" && index < next.length - 1 && next[index].length > 0) {
        const moved = next[index].pop()!;
        next[index + 1].unshift(moved);
      }
      return next;
    });
  }

  function handleToggleSet(id: string) {
    setSelectedSetIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Marks the batch just written as covered and moves on — deliberately not
  // gated on the result looking correct (Dom: "man ist fein damit, dass
  // nicht alles korrekt ist"). A character that came out badly is still
  // visible as such in the result grid; fixing it up is an Editor job, not
  // something /writer blocks progress on. Clears result state directly
  // (not just via the text-change effect) so there's no one-render flash of
  // the old groups/labels against the new, shorter (or empty) `letters`.
  function handleAdvanceBatch() {
    setCoveredChars((prev) => {
      const next = new Set(prev);
      for (const l of letters) next.add(l);
      saveCoveredChars(next);
      return next;
    });
    strokesRef.current = [];
    liveRef.current = null;
    setStrokeCount(0);
    setGroups([]);
    setLabels([]);
    setPhase("draw");
  }

  function handleResetProgress() {
    const empty = new Set<string>();
    setCoveredChars(empty);
    saveCoveredChars(empty);
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#2a2822" }}>
      <MarketplaceNav />
      <h1 style={{ fontSize: 16, fontWeight: 500, color: "#6b675c", marginBottom: 4 }}>writer — Segmentierungs-Prototyp</h1>
      <p style={{ fontSize: 14, color: "#6b675c", maxWidth: 640, lineHeight: 1.5 }}>
        Schreib den Text oben mit Stylus oder Maus auf der Linie ab — wie eine Abschreibübung, keine Ausfüll-Kästchen.
        Danach gruppiert ein simpler Lücken-Abgleich (die größten Abstände zwischen Strichen, keine Erkennung, kein OCR)
        die Striche in {letters.length} Zeichen, weil die Zeichenfolge ja vorgegeben ist.
      </p>

      <div style={{ marginTop: 16, maxWidth: 640 }}>
        <label htmlFor="customText" style={{ display: "block", fontSize: 13, color: "#6b675c", marginBottom: 6 }}>
          Eigener Text zum Abschreiben{" "}
          <span style={{ color: "#a89f8c" }}>
            (überschreibt die automatische Zeichensatz-Abfrage unten — für Sprachen/Zeichen außerhalb der eingebauten Sets)
          </span>
        </label>
        <input
          id="customText"
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="Leer lassen für die automatische Zeichensatz-Abfrage"
          spellCheck={false}
          style={{
            width: "100%",
            fontSize: 14,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd6c7",
            color: "#2a2822",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ marginTop: 20, display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        {/* Native <details>/<summary> — a real dropdown with zero open/close
            state to manage, no outside-click handler needed. Eight inline
            checkboxes wrapped unpredictably and could scroll off-screen in
            a narrow viewport (found while testing); collapsed by default
            fixes that regardless of window width. */}
        <details style={{ position: "relative" }}>
          <summary
            style={{
              fontSize: 13,
              color: "#2a2822",
              cursor: "pointer",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #ddd6c7",
              background: "#fff",
              listStyle: "revert",
            }}
          >
            Zeichensätze ({selectedSetIds.length} ausgewählt)
          </summary>
          <div
            style={{
              position: "absolute",
              zIndex: 10,
              top: "calc(100% + 4px)",
              left: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              minWidth: 200,
              borderRadius: 6,
              border: "1px solid #ddd6c7",
              background: "#fff",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            {CHARACTER_SETS.map((set) => (
              <label key={set.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#2a2822" }}>
                <input type="checkbox" checked={selectedSetIds.includes(set.id)} onChange={() => handleToggleSet(set.id)} />
                {set.label}
                <span style={{ color: "#a89f8c" }}>({set.chars.length})</span>
              </label>
            ))}
          </div>
        </details>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: 13, color: "#a89f8c" }}>
            {selectedChars.length - remainingChars.length} / {selectedChars.length} Zeichen abgedeckt
          </span>
          <button
            type="button"
            onClick={handleResetProgress}
            style={{ fontSize: 12, padding: "3px 8px", borderRadius: 4, border: "1px solid #ddd6c7", background: "#fff", cursor: "pointer" }}
          >
            Fortschritt zurücksetzen
          </button>
        </div>
      </div>

      {allDone && (
        <p style={{ fontSize: 14, color: "#6b675c", marginTop: 24 }}>
          Alle {selectedChars.length} Zeichen der gewählten Zeichensätze wurden mindestens einmal abgefragt. Weitere
          Zeichensätze ankreuzen, oder "Fortschritt zurücksetzen" für einen neuen Durchlauf.
        </p>
      )}

      {phase === "draw" && !allDone && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20, marginTop: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label htmlFor="penSize" style={{ fontSize: 13, color: "#6b675c" }}>
                Strichstärke
              </label>
              <input
                id="penSize"
                type="range"
                min={MIN_PEN_SIZE}
                max={MAX_PEN_SIZE}
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
                style={{ width: 140 }}
              />
              <span style={{ fontSize: 13, color: "#a89f8c", width: 24 }}>{penSize}</span>
            </div>
            {/* Mono/Dynamic + Thinning hidden for now (Dom: "dynamic line
                erstmal verstecken") — UI decluttering while the character-
                set workflow is the focus, not a capability removal.
                penMode/thinning state and their effect on outlinePolygonsFor
                are untouched; only the toggle/slider are gone. Un-hide by
                restoring this block from git history if/when it's wanted
                again. */}
          </div>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ touchAction: "none", border: "1px solid #e3ddcd", borderRadius: 8, background: "#fff", cursor: "crosshair" }}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
            <button
              type="button"
              onClick={handleEvaluate}
              disabled={strokeCount === 0}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #2a2822",
                background: strokeCount === 0 ? "#eee" : "#2a2822",
                color: strokeCount === 0 ? "#999" : "#fff",
                cursor: strokeCount === 0 ? "default" : "pointer",
              }}
            >
              Auswerten
            </button>
            <button
              type="button"
              onClick={handleUndo}
              disabled={strokeCount === 0}
              title="Letzten Strich rückgängig machen (Cmd/Ctrl+Z)"
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #ddd6c7",
                background: "#fff",
                color: strokeCount === 0 ? "#c9c3b4" : "#2a2822",
                cursor: strokeCount === 0 ? "default" : "pointer",
              }}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ddd6c7", background: "#fff", cursor: "pointer" }}
            >
              Zurücksetzen
            </button>
            <span style={{ fontSize: 13, color: "#a89f8c" }}>{strokeCount} Striche erfasst</span>
          </div>
        </>
      )}

      {phase === "result" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 24 }}>
            {groups.map((strokes, i) => {
              const label = labels[i] ?? letters[i];
              // How many earlier cells (including this one) share this exact
              // label — 1 = first occurrence (the base letter), 2+ = a later
              // one (an alternate candidate). Only counts non-empty groups;
              // an empty cell's stale label shouldn't inflate the count.
              const trimmed = label.trim();
              const occurrence =
                trimmed === ""
                  ? 1
                  : groups.slice(0, i + 1).filter((g, j) => g.length > 0 && (labels[j] ?? letters[j]).trim() === trimmed).length;
              return (
                <ResultCell
                  key={i}
                  char={letters[i]}
                  strokes={strokes}
                  pen={pen}
                  label={label}
                  onLabelChange={(next) => handleLabelChange(i, next)}
                  occurrence={occurrence}
                  onMovePrev={i > 0 && strokes.length > 0 ? () => handleMoveStroke(i, "prev") : undefined}
                  onMoveNext={i < groups.length - 1 && strokes.length > 0 ? () => handleMoveStroke(i, "next") : undefined}
                />
              );
            })}
          </div>
          <p style={{ fontSize: 13, color: "#a89f8c", marginTop: 16 }}>
            Rot umrandet = keine Striche diesem Buchstaben zugeordnet. Sieht ein Kästchen falsch aus (Striche zweier
            Buchstaben vermischt), ist das ein Segmentierungs-Fehler — kein Erkennungs-Fehler, es gab ja keine Erkennung.
            Mit den Pfeil-Buttons lässt sich ein einzelner Strich zur Nachbarzelle verschieben, falls die Kursivschrift
            über eine Buchstabengrenze hinweg verbunden war.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button
              type="button"
              onClick={handleReset}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ddd6c7", background: "#fff", cursor: "pointer" }}
            >
              Nochmal
            </button>
            <button
              type="button"
              onClick={handleAdvanceBatch}
              style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #2a2822", background: "#2a2822", color: "#fff", cursor: "pointer" }}
            >
              Als abgedeckt markieren → nächste Zeichen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
