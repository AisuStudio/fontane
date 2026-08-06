"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { clearStrokes, loadStrokes, saveStrokes, type Stroke, type StrokeKind, type StrokePoint } from "@/lib/strokes";
import { nibPolygon, type Nib } from "@/lib/calligraphy";
import { loadGlyphs, saveGlyphs, unicodeFor, nextAlternateName, type Glyph, type GlyphKind } from "@/lib/glyphs";
import {
  BASIC_CONSONANTS,
  BASIC_JAMO,
  EM_BOX_FRACTION,
  JAMO_VARIANTS,
  allVariantSlots,
  batchimPenLimit,
  coverage,
  frequentSyllables,
  harvestSyllables,
  isHangulChar,
  variantName,
} from "@/lib/hangul";
import { HANGUL_STEPS, recommendedStepId } from "@/lib/hangulSteps";
import { harvestSyllable, type HarvestResult } from "@/lib/hangulHarvest";
import { HANGUL_EM, composeHangul, composeSyllable, composedScaleRange, jamoFrom } from "@/lib/hangulCompose";
import { anyPointInPolygon, pointInPolygon } from "@/lib/geometry";
import {
  applyBrush,
  applyCalligraphy,
  inkPointCount,
  DEFAULT_NIB,
  DEFAULT_SCATTER,
  type BrushKind,
  type BrushOptions,
  type BrushOutput,
  type NibParams,
  type RotationMode,
  type ScatterParams,
  type StampShape,
} from "@/lib/brush";
import {
  outlineToPath,
  outlineToSharpPath,
  pathToSvgD,
  skeletonToPath,
  unionOutlines,
  subtractOutlines,
  xorOutlines,
  flattenVectorShape,
  vectorShapeStrokeOutline,
  cubicPoint,
  splitVectorSegment,
  type PathCommand,
} from "@/lib/contour";
import {
  loadVectorShapes,
  saveVectorShapes,
  clearVectorShapes,
  isSmoothAnchor,
  alignOppositeHandle,
  constrainTo45,
  toggleAnchorSmooth,
  shapeRenderMode,
  shapeStrokeWidth,
  type VectorShape,
  type BezierAnchor,
  type BezierPoint,
} from "@/lib/vectorShapes";
import { setClipboard, getClipboard, type ClipboardStroke, type ClipboardShape } from "@/lib/clipboard";
import { initHeldKeys, getHeldKeys } from "@/lib/heldKeys";
import { PEN, PEN_ADD, PEN_MINUS, PEN_CLOSE, PEN_CONTINUE, CONVERT, PEN_ANCHOR_CLICK } from "@/lib/cursors";
import { simplifyStrokeIndices } from "@/lib/simplify";
import { buildFont, downloadFont } from "@/lib/exportFont";
import { downloadSkeletonSvg } from "@/lib/exportSkeleton";
import { saveFile } from "@/lib/saveFile";
import { loadMetrics, saveMetrics, DEFAULT_METRICS, type Metrics } from "@/lib/metrics";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type StrokeSettings } from "@/lib/settings";
import { loadSectionOpen, saveSectionOpen } from "@/lib/uiPrefs";
import { downloadProjectFile, parseProjectFile, applyProjectFile, buildProjectFile } from "@/lib/projectFile";
import { createClient as createBrowserClient } from "@/lib/supabaseBrowser";
import { layoutText } from "@/lib/layoutText";
import {
  Undo2,
  Redo2,
  Pencil,
  Brush,
  Eraser,
  BookA,
  SplinePointer,
  MousePointer2,
  Lasso,
  Move,
  RotateCw,
  Scaling,
  Hand,
  PenTool,
  PenLine,
  CirclePlus,
  CircleMinus,
  Spline,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import GridCell, { DEFAULT_LEFT_BEARING, DEFAULT_RIGHT_BEARING, type CellTool } from "./GridCell";
import CoachMarks from "./CoachMarks";
import Writer from "./writer/Writer";
import SettingsSection from "./SettingsSection";
import BetaBadge from "./BetaBadge";
import {
  CHARACTER_SETS,
  DEFAULT_CHARACTER_SET_IDS,
  DEFAULT_SCRIPT,
  SCRIPTS,
  activeScripts,
  scriptById,
  scriptOf,
  type ScriptId,
} from "@/lib/charsets";
import AnimatePanel from "./AnimatePanel";
import EditorPanel, { DEFAULT_EDITOR_FONT_SIZE_PT, EDITOR_SAMPLE_TEXT } from "./EditorPanel";
import { DEFAULT_PRESET_ID, type AnimationPresetId } from "@/lib/animationPresets";
import { trackAuth, trackCharset, trackError, trackExport, trackGate, trackToolUse, trackUndo, notePointer } from "@/lib/analytics";
import { useVisitTracking } from "@/lib/visitDuration";
import {
  getAuthorId,
  getDraftId,
  rollDraftId,
  summarizeStroke,
  enqueueProvenanceEvent,
  flushProvenanceQueue,
  flushProvenanceQueueAndWait,
} from "@/lib/provenance";

// Draw has three styles: Free (the old "Write" freeform canvas), Grid (one
// glyph per cell), and Editor (compose/preview text using already-tagged
// glyphs — no drawing of its own yet).
type TopMode = "draw" | "animate";
type DrawStyle = "free" | "grid" | "editor" | "writer";
// Nudge and Assign only ever apply to Free — reshaping a Grid cell's
// single-letter stroke via anchors, or lasso-tagging a stroke to a glyph,
// isn't the point of the Grid/Editor views (Grid already tags a stroke to
// its glyph the moment it's drawn, so there's nothing to assign there).
// Select is the bare lasso gesture Move/Rotate/Scale below all read from —
// Assign keeps the exact same gesture plus its own tag-form panel, so the
// two share the lasso code paths (see LASSO_TOOLS) rather than duplicating
// them.
type DrawTool =
  | "pen"
  | "brush"
  | "calligraphy"
  | "eraser"
  | "nudge"
  | "anchor"
  | "vector"
  | "vectorAdd"
  | "vectorDelete"
  | "vectorConvert"
  | "assign"
  | "select"
  | "move"
  | "rotate"
  | "scale"
  | "pan";
// The 5 menu-bar dropdowns — "charset" (the Grid context bar's Character
// sets picker) is a separate, click-only dropdown, not part of the hover
// group below. The "flyout-*" keys are the toolbar's Illustrator-style
// tool-group flyouts (see ToolGroup) — they ride the same openMenu state
// so outside-click dismissal and only-one-menu-open-at-a-time come for
// free (the toolbar row is tagged data-chrome-menu just like the menu bar).
type MenuKey =
  | "glypher" | "file" | "edit" | "view" | "tools" | "marketplace" | "charset" | "cloud"
  | "flyout-penFamily" | "flyout-editFamily" | "flyout-transform";
// One entry per Grid cell — the fixed character sets contribute one slot
// per character (kind always "base"), and a user can append arbitrary extra
// slots (ligatures, alternates, or a one-off base symbol outside any set) via
// the Character Sets dropdown's "Add glyph" form. A slot only describes what
// cell to show and, for a brand-new glyph, what to tag it as on first stroke
// (see handleGridStroke) — components/alternateOf are otherwise unused once
// the underlying Glyph already exists.
type GridSlot = { name: string; kind: GlyphKind; components?: string[]; alternateOf?: string };
// Tools whose pointerdown-through-pointerup gesture on empty/stroke space is
// "drag out a lasso and replace selectedIds with whatever it enclosed".
const LASSO_TOOLS = new Set<DrawTool>(["assign", "select"]);
// Illustrator parity: holding Cmd/Ctrl while one of these is active swaps the
// gesture for a momentary lasso-select (same polygon-match as the Select
// tool), released back to normal drawing the instant the pointer lifts. Only
// the tools whose own gesture is a plain draw/erase qualify — Nudge/Anchor/
// Vector/transform tools already have their own Cmd/Ctrl or modifier meaning
// (see handleVectorPointerDown's directSelect) and are deliberately excluded.
const CMD_SELECT_OVERRIDE_TOOLS = new Set<DrawTool>(["pen", "brush", "calligraphy", "eraser"]);
// Tools that read (rather than replace) the current selection — switching
// among these must NOT clear selectedIds, unlike switching to pen/eraser/
// nudge/pan, which should.
const SELECTION_TOOLS = new Set<DrawTool>(["assign", "select", "move", "rotate", "scale"]);
// Tools whose pointerdown/move/up is a rigid transform (translate/rotate/
// scale) applied to the current selection, via handleTransformPointerDown/
// applyTransform below.
const TRANSFORM_TOOLS = new Set<DrawTool>(["move", "rotate", "scale"]);
// The Vector family — the Bezier pen plus Illustrator's three Pen-submenu
// anchor tools. They all drive the same handleVectorPointerDown/Move/Up and
// share ONE editing session (editingShapeIdRef), the same way Pen/Nudge/Anchor
// share the stroke-editing one: switching from the pen to Add/Delete/Convert
// mid-shape must not drop the shape you're working on, since those tools have
// nothing to show without it.
const VECTOR_TOOLS = new Set<DrawTool>(["vector", "vectorAdd", "vectorDelete", "vectorConvert"]);
// Tools whose work product is (or reshapes) a perfect-freehand STROKE — the
// ones the Mono/Dynamic + Size/Thinning/… sliders actually apply to. The
// stroke sliders are canvas-wide render settings, but showing them while a
// vector or transform tool is active is pure noise — Glyphs shows only the
// panels relevant to the active tool, so the Stroke section follows suit.
// Calligraphy belongs here too, but shows its own nib panel instead of the
// brush one — see the Stroke section in the sidebar.
const STROKE_TOOLS = new Set<DrawTool>(["pen", "brush", "calligraphy", "eraser", "nudge", "anchor"]);

// The one space every Grid glyph is drawn and stored in. Its value is
// arbitrary — it is a resolution, not a size — but it must never change: it is
// the unit every glyph's recorded cellWidth/cellHeight is expressed in, and
// moving it would re-weight every letter ever drawn. 240 was the old Cell size
// slider's maximum, so nothing existing exceeds it.
const CANONICAL_CELL = 240;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const DEFAULT_ZOOM = 0.375; // 90px, the cell size this replaced defaulted to

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 40) / 40));
}
// The three tools that lay down ink with the active brush/nib — the ones
// whose OS cursor gets replaced by the true-size, true-angle brush-shape ring
// (see drawBrushCursor), since Eraser/Nudge/Anchor have no brush shape to show.
const INK_TOOLS = new Set<DrawTool>(["pen", "brush", "calligraphy"]);
// Every DrawTool whose button only ever appears when drawStyle==="free" —
// leaving Free resets drawTool back to "pen" if it's one of these, since
// their UI vanishes and a stale value would silently persist otherwise.
// Select/Nudge/Move/Rotate/Scale/Vector all work in Grid too (GridCell has
// its own local port of the same select/reshape/transform/Bezier logic) —
// only Assign (Grid auto-tags on draw, nothing to assign), Pan (a single
// small fixed cell has nothing to pan around), and Anchor (single-anchor
// select/insert/delete — Grid cells are small and already busy with bearing
// handles) stay Free-exclusive.
const FREE_ONLY_TOOLS = new Set<DrawTool>(["assign", "pan", "anchor"]);

// Single source of truth for the sidebar's TOOLS section, the menu bar's
// Tools dropdown, AND the keyboard shortcuts below — one place to add a
// tool so none of the three can drift out of sync with each other.
// altShortcut is a second key that selects the same tool without being the one
// advertised in the UI — Add Anchor's "=" works on keyboards where "+" costs
// a Shift (Illustrator's own convention), and Vector keeps "v" as a muscle-
// memory alias from before it moved to Illustrator's own P.
// Tools sharing a group collapse into ONE toolbar slot with a long-press/
// hover flyout — Illustrator's stacked-tool flyouts (Pen ▸ Add/Delete/
// Convert Anchor) exactly. Grouping only compacts the toolbar row: the menu
// bar's Tools dropdown and the keyboard shortcuts keep reading the flat list.
type ToolGroup = "penFamily" | "editFamily" | "transform";
type ToolDef = { value: DrawTool; label: string; icon: typeof Brush; shortcut: string; altShortcut?: string; group?: ToolGroup };
const TOOL_DEFS: ToolDef[] = [
  { value: "pen", label: "Draw", icon: Pencil, shortcut: "b" },
  { value: "vector", label: "Vector", icon: PenTool, shortcut: "p", altShortcut: "v", group: "penFamily" },
  // Illustrator's Pen submenu, in its order: add / delete / convert.
  { value: "vectorAdd", label: "Add Anchor", icon: CirclePlus, shortcut: "+", altShortcut: "=", group: "penFamily" },
  { value: "vectorDelete", label: "Delete Anchor", icon: CircleMinus, shortcut: "-", group: "penFamily" },
  { value: "vectorConvert", label: "Convert Anchor", icon: Spline, shortcut: "c", group: "penFamily" },
  { value: "brush", label: "Brush", icon: Brush, shortcut: "u" },
  { value: "calligraphy", label: "Calligraphy", icon: PenLine, shortcut: "y" },
  { value: "eraser", label: "Erase", icon: Eraser, shortcut: "e" },
  { value: "select", label: "Select", icon: Lasso, shortcut: "l", group: "editFamily" },
  { value: "nudge", label: "Nudge", icon: SplinePointer, shortcut: "n", group: "editFamily" },
  // "d" (Direct-ish) — Anchor gave its old "p" to Vector, Illustrator's Pen key.
  { value: "anchor", label: "Anchor", icon: MousePointer2, shortcut: "d", group: "editFamily" },
  { value: "move", label: "Move", icon: Move, shortcut: "m", group: "transform" },
  { value: "rotate", label: "Rotate", icon: RotateCw, shortcut: "r", group: "transform" },
  { value: "scale", label: "Scale", icon: Scaling, shortcut: "s", group: "transform" },
  { value: "pan", label: "Pan", icon: Hand, shortcut: "h" },
  { value: "assign", label: "Assign", icon: BookA, shortcut: "a" },
];

// Same idea for the sidebar's VIEWS section and the menu bar's View dropdown
// — a flat list synthesized across the two underlying state variables
// (topMode/drawStyle) that "which view is active" actually spans.
type ViewDef = { key: string; label: string; topMode: TopMode; drawStyle?: DrawStyle };
// Animate is deliberately left out of this list — not far enough along yet
// to expose in the nav — but topMode==="animate" and AnimatePanel itself are
// untouched, so re-adding a { key: "animate", ... } entry here is all it'll
// take to bring it back. Export isn't a view either: it has no view of its
// own to switch into (File's Export FFF/JSON/OTF/Skeleton SVG actions cover
// the whole surface already) — it used to be a JSON-preview panel, but that
// duplicated what File already does and confused "view" with "action".
const VIEW_DEFS: ViewDef[] = [
  { key: "grid", label: "Grid View", topMode: "draw", drawStyle: "grid" },
  { key: "free", label: "Sketcher", topMode: "draw", drawStyle: "free" },
  { key: "editor", label: "Typer", topMode: "draw", drawStyle: "editor" },
  { key: "writer", label: "Writer (beta)", topMode: "draw", drawStyle: "writer" },
];

// The sidebar's Brush section, in the order they generalize: the envelope
// that was always here, then the two that need the arc-length path space
// (src/lib/pathSpace.ts). Same flat-list convention as TOOL_DEFS/VIEW_DEFS.
const BRUSH_DEFS: { kind: BrushKind; label: string; hint: string }[] = [
  { kind: "freehand", label: "Free", hint: "Pressure envelope — the original pen" },
  { kind: "nib", label: "Nib", hint: "Swept calligraphy nib: contrast from direction of travel" },
  { kind: "scatter", label: "Stipple", hint: "Stamps repeated along the path at a set spacing" },
];

const STAMP_DEFS: { shape: StampShape; label: string }[] = [
  { shape: "dot", label: "Dot" },
  { shape: "square", label: "Sq" },
  { shape: "triangle", label: "Tri" },
  { shape: "dash", label: "Dash" },
];

const ROTATION_DEFS: { mode: RotationMode; label: string; hint: string }[] = [
  { mode: "follow", label: "Follow", hint: "Each stamp turns with the path's tangent" },
  { mode: "fixed", label: "Fixed", hint: "One page angle for every stamp — engraving/hatching" },
  { mode: "random", label: "Rand", hint: "A new angle per stamp, seeded per stroke" },
];

const COLOR_DEFAULT = "#1f1934"; // blueberry — untagged
const COLOR_SELECTED = "#d8ff01"; // lemon — pending selection
const COLOR_TAGGED = "#5100ff"; // grape — assigned to a glyph
const ANCHOR_COLOR = "#5100ff"; // grape — matches the draggable-affordance color used elsewhere (GridCell's bearing handles)
const ANCHOR_RING_COLOR = "#eae8e0"; // vanilla — ring for contrast against the stroke color
const SKELETON_GUIDE_COLOR = "#9e9c95"; // hazelnut
// Vector-shape rendering, one meaning per color: blueberry outlines a resting
// shape, grape (ANCHOR_COLOR) marks the one being edited — matching its own
// anchors and handles — and hazelnut fills the body underneath both. This
// replaces the older tagged-vs-untagged outline split, whose grape/hazelnut
// pair now means something else entirely.
const VECTOR_OUTLINE_COLOR = "#1f1934"; // blueberry — ink, matches drawn strokes
const VECTOR_FILL_COLOR = "#9e9c95"; // hazelnut — muted body under the outlines
const VECTOR_LINE_WIDTH = 0.5; // hairline, matching the guides/bearings everywhere else (see GridCell)
const FREE_RASTER_COLOR = "#FFABAB"; // Free mode's ruled-line background only — not shared with the Nudge skeleton preview or transform pivot line, which stay hazelnut
const ANCHOR_HIT_PX = 8;

function optionsFor(settings: StrokeSettings): BrushOptions {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
    brush: settings.brush,
  };
}

// The Calligraphy tool's own three settings, pulled out of the shared
// StrokeSettings blob into the shape src/lib/calligraphy.ts works in.
function nibFor(settings: StrokeSettings): Nib {
  return { size: settings.nibSize, ratio: settings.nibRatio, angle: settings.nibAngle };
}

// Which outline generator a stroke gets is decided by the tool that DREW it,
// not by whatever tool or brush is selected now — a calligraphy stroke keeps
// its nib outline forever, the same way a pen stroke keeps its
// pressure-thinned one; every other stroke goes through the active brush.
// `kind` is optional so the live in-progress path can pass the active tool's
// kind before there's a Stroke object to read it off. `seedKey` should be
// the stroke's own id wherever there is one — it's what makes a scatter
// brush deterministic (see src/lib/brush.ts). The default only covers the
// in-progress stroke, which has no id until it's committed and is
// re-rendered from scratch every frame anyway.
function outlineFor(points: StrokePoint[], settings: StrokeSettings, kind?: StrokeKind, seedKey = "live"): BrushOutput {
  if (kind === "calligraphy") return applyCalligraphy(points, nibFor(settings));
  return applyBrush(points, optionsFor(settings), seedKey);
}

// A Scale-tool gesture bakes its magnitude into the stroke's own widthScale
// (see applyTransform) so relative thickness stays constant as the shape
// grows/shrinks, instead of every stroke sharing one fixed global size. Both
// widths scale together: a stroke only ever uses one of the two, depending on
// whether it was drawn with the pen or the nib.
function effectiveSettingsFor(stroke: Stroke, settings: StrokeSettings): StrokeSettings {
  const ws = stroke.widthScale ?? 1;
  return ws === 1 ? settings : { ...settings, size: settings.size * ws, nibSize: settings.nibSize * ws };
}

// The single call every already-completed stroke's outline goes through: its
// own kind, its own id as the brush seed, and its own baked-in widthScale,
// against the current settings.
function strokeOutline(stroke: Stroke, settings: StrokeSettings): BrushOutput {
  return outlineFor(stroke.points, effectiveSettingsFor(stroke, settings), stroke.kind, stroke.id);
}

// What the tool currently in hand records on the strokes it lays down (and
// reports to provenance/analytics). Every other DrawTool edits existing ink
// rather than making any, so they never reach here — "pen" is just the
// unreachable default. GridCell.tsx keeps its own copy over CellTool, the
// same local-duplication split the two canvases already use everywhere else.
function strokeKindFor(tool: DrawTool): StrokeKind {
  if (tool === "brush") return "brush";
  if (tool === "calligraphy") return "calligraphy";
  return "pen";
}

// The nib itself, drawn at true canvas size on the settings panel's dark
// ground — the one picture that shows all three of its settings at once: how
// big the oval is, how narrow, and how far it's tilted. The box is fixed at
// the widest a nib can get (the Nib size slider's own max), so a bigger nib
// genuinely looks bigger here instead of being auto-fitted back to the same
// apparent size.
const NIB_PREVIEW_BOX = 60;

function NibPreview({ nib }: { nib: Nib }) {
  const half = NIB_PREVIEW_BOX / 2;
  const points = nibPolygon(0, 0, nib)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  return (
    <svg
      viewBox={`${-half} ${-half} ${NIB_PREVIEW_BOX} ${NIB_PREVIEW_BOX}`}
      width="100%"
      height={NIB_PREVIEW_BOX}
      role="img"
      aria-label={`Nib: ${nib.size} px, oval ${nib.ratio.toFixed(2)}, tilted ${nib.angle} degrees`}
    >
      <polygon points={points} fill={COLOR_SELECTED} />
    </svg>
  );
}

// Same idea as NibPreview, generalized to the other applicator: a fixed
// skeleton run through outlineFor with the CURRENT settings, so Free/Nib/
// Stipple, Mono/Dynamic, and every one of that brush's own parameters render
// as one picture instead of a mental model built from slider readouts. Two
// humps rather than a straight line or a single curve — a nib's width
// depends on travel direction, so a one-directional sample would only ever
// show one side of its contrast, and a scatter brush's spacing/jitter needs
// more than a few px of path to read as a pattern at all.
const STROKE_PREVIEW_WIDTH = 200;
const STROKE_PREVIEW_HEIGHT = 60;

function strokePreviewSkeleton(): StrokePoint[] {
  const points: StrokePoint[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 8 + t * (STROKE_PREVIEW_WIDTH - 16);
    const y = STROKE_PREVIEW_HEIGHT / 2 + Math.sin(t * Math.PI * 2) * (STROKE_PREVIEW_HEIGHT / 2 - 10);
    // Ramps 0.25 -> 1 -> 0.25 — a natural pen lift at both ends, so Dynamic
    // mode's taper (and Mono's deliberate lack of one) is visible without
    // needing a real drawn stroke to compare against.
    const pressure = Math.sin(t * Math.PI) * 0.75 + 0.25;
    points.push([x, y, pressure]);
  }
  return points;
}
// Computed once at module scope: the skeleton itself never changes, only
// what's applied to it.
const STROKE_PREVIEW_SKELETON = strokePreviewSkeleton();

function StrokePreview({ settings }: { settings: StrokeSettings }) {
  const out = outlineFor(STROKE_PREVIEW_SKELETON, settings, undefined, "stroke-preview");
  const d = out.polygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => pathToSvgD(out.smooth ? outlineToPath(polygon) : outlineToSharpPath(polygon)))
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${STROKE_PREVIEW_WIDTH} ${STROKE_PREVIEW_HEIGHT}`}
      width="100%"
      height={STROKE_PREVIEW_HEIGHT}
      role="img"
      aria-label="Preview of the current stroke settings"
    >
      <path d={d} fill={COLOR_SELECTED} fillRule="nonzero" />
    </svg>
  );
}

// Lowercase letters that dip below the baseline (their body still sits in
// the x-height band, only the tail extends to the descender line) vs. ones
// that reach the ascender line — used to pick which pair of guide lines a
// bbox-fallback glyph's own bounding box gets normalized against below. Any
// name not covered here (uppercase, digits, accented letters, ligatures)
// falls back to the full ascender-to-baseline band.
const DESCENDER_LETTERS = new Set(["g", "j", "p", "q", "y"]);
const ASCENDER_LETTERS = new Set(["b", "d", "f", "h", "k", "l", "t"]);

function bandFor(name: string, metrics: Metrics): { top: number; bottom: number } {
  // Korean has no baseline band to fall into — a jamo occupies the em square,
  // so a Free-tagged one gets fitted to the whole cell rather than squeezed
  // between the x-height and a baseline that means nothing to it.
  if (isHangulChar(name)) return { top: 0, bottom: 1 };
  const isLowerLatin = name.length === 1 && name >= "a" && name <= "z";
  if (isLowerLatin) {
    if (DESCENDER_LETTERS.has(name)) return { top: metrics.xHeight, bottom: metrics.descender };
    if (ASCENDER_LETTERS.has(name)) return { top: metrics.ascender, bottom: metrics.baseline };
    return { top: metrics.xHeight, bottom: metrics.baseline };
  }
  return { top: metrics.ascender, bottom: metrics.baseline };
}

// Glyphs tagged via Free-mode Assign carry raw pen coordinates captured on
// the large Free canvas (e.g. x in the hundreds) — rendered as-is inside a
// Grid cell's own small canvas (~90px), they land far outside the visible
// area. Grid-native glyphs (drawn directly in a cell, cellWidth/cellHeight
// set) are calibrated to that recorded cell size — see fromAnchorSpace/
// toAnchorSpace below for how they're kept in sync when Cell size/width
// changes later. This rescales+recenters a bbox-fallback glyph's combined stroke bbox to
// fit its own letter-appropriate guide band (x-height/ascender/descender —
// a lowercase "a" belongs in the x-height, not stretched up to the full
// ascender height) — same idea as layoutText.ts's bbox-fallback transform
// but centered (a single grid cell isn't part of a text line) and band-aware.
// Returns the computed scale alongside the fitted points — a Free-tagged
// glyph's raw pen coordinates are captured on the large Free canvas (e.g.
// hundreds of px tall), so fitting them into a small Grid cell is always a
// dramatic scale-down. Callers MUST fold this into the stroke's widthScale
// before rendering, or the stroke thickness stays calibrated for the
// original Free-canvas size and renders wildly too thick for the shrunk
// letterforms — the same class of bug fixed for Editor mode's font-size
// scaling (see EditorPanel.tsx's effectiveSettingsFor).
function fitStrokesToCell(
  glyphStrokes: Stroke[],
  glyphName: string,
  cellWidthPx: number,
  cellHeightPx: number,
  metrics: Metrics
): { points: StrokePoint[][]; scale: number } {
  const allPoints = glyphStrokes.flatMap((s) => s.points);
  if (allPoints.length === 0) return { points: glyphStrokes.map(() => []), scale: 1 };
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const h = ymax - ymin || 1;
  const { top, bottom } = bandFor(glyphName, metrics);
  const targetHeight = Math.max((bottom - top) * cellHeightPx, 1);
  const scale = targetHeight / h;
  const bottomPx = bottom * cellHeightPx;
  const offsetY = bottomPx - ymax * scale;
  const w = (xmax - xmin) * scale;
  const offsetX = (cellWidthPx - w) / 2 - xmin * scale;
  return {
    points: glyphStrokes.map((s) =>
      s.points.map((p) => [p[0] * scale + offsetX, p[1] * scale + offsetY, p[2]] as StrokePoint)
    ),
    scale,
  };
}

// A Grid-native glyph's stroke points are stored in the pixel space of
// whatever Cell size/width was current the moment they were drawn (its
// "anchor" — glyph.cellWidth/cellHeight). Without this, changing the
// sliders later would resize the cell but leave existing letters frozen at
// their old pixel size. fromAnchorSpace expands anchor-space points to fill
// however big the cell renders right now (used for display); toAnchorSpace
// is the inverse, converting a freshly-drawn/edited stroke's current-pixel-
// space points back into that same anchor so every stroke of a glyph keeps
// sharing one consistent coordinate system no matter when it was touched.
function fromAnchorSpace(
  points: StrokePoint[],
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): StrokePoint[] {
  if (!anchorWidth || !anchorHeight || (anchorWidth === currentWidth && anchorHeight === currentHeight)) {
    return points;
  }
  const { scaleX, scaleY } = anchorScales(anchorWidth, anchorHeight, currentWidth, currentHeight, keepProportions);
  return points.map(([x, y, p]) => [x * scaleX, y * scaleY, p] as StrokePoint);
}

// The two axes a glyph is rescaled by, and the one place that decides how
// Width interacts with them.
//
// Height carries only the zoom: a cell's height is cellSize x the script's
// aspect and never consults the Width ratio, so scaleY is the uniform part
// of the transform. Width is the deliberate distortion — an "m" wants more
// room than an "i" — and it is horizontal, full stop. It must never reach
// the vertical axis, which is what "keepProportions = min of both" used to
// do: narrowing a cell shrank the letter's height with it.
//
// So keepProportions now means "ignore Width, stay undistorted" (scaleX
// follows scaleY) rather than "let the narrower axis win". Either way the
// vertical axis answers to the zoom alone.
function anchorScales(
  anchorWidth: number,
  anchorHeight: number,
  currentWidth: number,
  currentHeight: number,
  keepProportions: boolean
): { scaleX: number; scaleY: number } {
  const scaleY = currentHeight / anchorHeight;
  return { scaleX: keepProportions ? scaleY : currentWidth / anchorWidth, scaleY };
}

// The same rescale expressed as one number for stroke thickness.
//
// Deliberately the VERTICAL scale, not the geometric mean of both: a stroke
// stores a centreline, and the ink is laid along it at render time. Squeezing
// a skeleton horizontally is what a compressed cut does, and it leaves the
// pen alone — stems keep their weight, exactly as they do in a stroke-based
// font. Folding the horizontal squeeze in (the old sqrt(scaleX * scaleY))
// thinned every letter as the Width slider moved, which is a weight change
// nobody asked a width control for.
function anchorSpaceWidthScale(
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): number {
  if (!anchorWidth || !anchorHeight) return 1;
  return Math.abs(anchorScales(anchorWidth, anchorHeight, currentWidth, currentHeight, keepProportions).scaleY);
}

function toAnchorSpace(
  points: StrokePoint[],
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): StrokePoint[] {
  if (!anchorWidth || !anchorHeight || (anchorWidth === currentWidth && anchorHeight === currentHeight)) {
    return points;
  }
  const { scaleX, scaleY } = anchorScales(anchorWidth, anchorHeight, currentWidth, currentHeight, keepProportions);
  return points.map(([x, y, p]) => [x / scaleX, y / scaleY, p] as StrokePoint);
}

// Vector shapes tagged into a Grid glyph live in that same per-glyph anchor
// space its strokes do (see fromAnchorSpace above), but as {x,y} anchors with
// control handles rather than [x,y,pressure] tuples — so they need their own
// thin wrapper around the same two scale factors. `invert` picks the
// direction: default is fromAnchorSpace (stored → what a cell displays right
// now), invert is toAnchorSpace (what a cell reports back → stored). Always
// rebuilds every anchor, even at scale 1: GridCell mutates the shapes it's
// handed in place during a drag, so passing aliases of the shared
// vectorShapesRef objects either way would let a half-finished gesture corrupt
// the store.
function vectorShapeAcrossAnchorSpace(
  shape: VectorShape,
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false,
  invert = false
): VectorShape {
  let scaleX = 1;
  let scaleY = 1;
  if (anchorWidth && anchorHeight) {
    // Same two factors the strokes use, from the same place — vector shapes
    // and ink share a cell and must never drift apart under Width or zoom.
    ({ scaleX, scaleY } = anchorScales(anchorWidth, anchorHeight, currentWidth, currentHeight, keepProportions));
  }
  if (invert) {
    scaleX = 1 / scaleX;
    scaleY = 1 / scaleY;
  }
  const scaled = (p: BezierPoint): BezierPoint => ({ x: p.x * scaleX, y: p.y * scaleY });
  return {
    ...shape,
    anchors: shape.anchors.map((a) => ({
      ...scaled(a),
      ...(a.handleIn ? { handleIn: scaled(a.handleIn) } : {}),
      ...(a.handleOut ? { handleOut: scaled(a.handleOut) } : {}),
      // Carried explicitly, since the rebuild above starts from {x,y} alone.
      // Losing it would demote every deliberately-broken point back to
      // isSmoothAnchor's geometric guess on the next Grid round trip.
      ...(a.smooth !== undefined ? { smooth: a.smooth } : {}),
    })),
  };
}

// Pivot for Move/Rotate/Scale: the bounding-box center across every
// currently-selected stroke's points, same shape as fitStrokesToCell's own
// bbox loop above (a single shared box across the whole selection, not one
// per stroke, so a multi-stroke selection transforms as one rigid group).
function selectionPivot(strokes: Stroke[]): { x: number; y: number } {
  const allPoints = strokes.flatMap((s) => s.points);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
}

// Default Scale anchor (no modifier held): bottom-left of the same bbox
// selectionPivot uses — canvas is y-down, so "bottom" is the max-y edge.
function selectionBottomLeft(strokes: Stroke[]): { x: number; y: number } {
  const allPoints = strokes.flatMap((s) => s.points);
  let xmin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x);
    ymax = Math.max(ymax, y);
  }
  return { x: xmin, y: ymax };
}

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

// Vector-tool shapes are true cubic Beziers, so this draws them with canvas's
// own bezierCurveTo directly — no flattening/approximation needed on screen
// (that only happens at compile time, see flattenVectorShape in contour.ts).
function applyVectorShapePath(ctx: CanvasRenderingContext2D, shape: VectorShape) {
  if (shape.anchors.length < 2) return;
  ctx.moveTo(shape.anchors[0].x, shape.anchors[0].y);
  const segmentCount = shape.closed ? shape.anchors.length : shape.anchors.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = shape.anchors[i];
    const p1 = shape.anchors[(i + 1) % shape.anchors.length];
    const c1 = p0.handleOut ?? p0;
    const c2 = p1.handleIn ?? p1;
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y);
  }
  if (shape.closed) ctx.closePath();
}

// One path for every polygon a brush produced, filled once. Nonzero winding
// does the same job here that unionOutlines does at export time — hundreds of
// overlapping scatter stamps read as one connected mark without the cost of a
// real boolean union on every frame.
function fillOutline(ctx: CanvasRenderingContext2D, out: BrushOutput, color: string) {
  if (out.polygons.length === 0) return;
  // Shares outlineToPath with the SVG export (src/lib/contour.ts) so the canvas
  // rendering and the exported document always describe the same curve.
  ctx.beginPath();
  for (const polygon of out.polygons) {
    if (polygon.length < 3) continue;
    applyPath(ctx, out.smooth ? outlineToPath(polygon) : outlineToSharpPath(polygon));
  }
  ctx.fillStyle = color;
  ctx.fill();
}

// The shared editable document: every glyph resolved to its actual contours (SVG
// path data, one per stroke), plus the identity/relationship fields from Phase 2.
// This is what a later export step (SVG + .fea, or a direct fontTools compile)
// would consume — nothing here writes anywhere, it's just compiled on demand.
function compileDocument(
  glyphs: Glyph[],
  strokes: Stroke[],
  vectorShapes: VectorShape[],
  settings: StrokeSettings,
  metrics: Metrics
) {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const shapesById = new Map(vectorShapes.map((s) => [s.id, s]));
  return {
    version: 1,
    settings: optionsFor(settings),
    metrics,
    glyphs: glyphs.map((g) => {
      // Strokes are drawn independently and can overlap (e.g. the crossbar
      // and stem of a "t") — union their outlines into clean, non-
      // overlapping contours before exporting, so overlapping/self-
      // intersecting paths don't glitch in font rasterizers downstream.
      const glyphStrokes = g.strokeIds.map((id) => byId.get(id)).filter((s): s is Stroke => Boolean(s));
      // A brush can emit many polygons per stroke (one per stamp, for the
      // scatter brush) — they union in exactly like separately drawn strokes
      // already did, so the overlap handling below is unchanged. Stroke-mode
      // Vector shapes (open or closed — see VectorShape.renderMode) union in
      // right alongside them: they're precision-drawn ink, not a fill/punch.
      const vectorShapesInGlyph = (g.vectorShapeIds ?? []).map((id) => shapesById.get(id));
      const fillShapes = vectorShapesInGlyph.filter(
        (s): s is VectorShape => Boolean(s && s.closed && shapeRenderMode(s) !== "stroke")
      );
      const strokeShapes = vectorShapesInGlyph.filter(
        (s): s is VectorShape => Boolean(s && shapeRenderMode(s) === "stroke")
      );
      // A closed stroke shape's own outline is [outer ring, hole ring] (see
      // vectorShapeStrokeOutline's subtractOutlines call) — folding both
      // straight into one flat unionOutlines() list the way brush strokes'
      // (hole-free) polygons already do would union the hole's area right
      // back into the shape, since union only ever ADDS coverage and the
      // hole ring sits entirely inside the outer one. Keeping each shape's
      // first ring (outer) separate from the rest (holes) and subtracting
      // the holes only at the end, after every positive contribution has
      // unioned together, is what actually preserves them.
      const strokeShapeOutlines = strokeShapes.map((s) => vectorShapeStrokeOutline(s, shapeStrokeWidth(s)));
      const positiveInk = unionOutlines([
        ...glyphStrokes.flatMap((s) => strokeOutline(s, settings).polygons),
        ...strokeShapeOutlines.map((rings) => rings[0]).filter((r): r is [number, number][] => Boolean(r)),
      ]);
      const strokeShapeHoles = strokeShapeOutlines.flatMap((rings) => rings.slice(1));
      const inkUnion = strokeShapeHoles.length > 0 ? subtractOutlines(positiveInk, strokeShapeHoles) : positiveInk;
      // Fill-mode Vector shapes default to punching a hole in the glyph's ink
      // — see contour.ts's subtractOutlines. A glyph with fill shapes but no
      // other ink has nothing to subtract FROM, so those become the letter
      // itself. Either way the fill shapes are first combined with each other
      // by the even-odd rule (xorOutlines), so a counter drawn inside an
      // outline — the B/O/A case, and the only way to draw a closed letter in
      // pure vector — stays a counter instead of being swallowed by a union.
      const vectorOutlines = fillShapes.map((s) => flattenVectorShape(s));
      let rings: [number, number][][];
      if (vectorOutlines.length === 0) {
        rings = inkUnion;
      } else if (inkUnion.length === 0) {
        rings = xorOutlines(vectorOutlines);
      } else {
        rings = subtractOutlines(inkUnion, xorOutlines(vectorOutlines));
      }
      return {
        name: g.name,
        kind: g.kind,
        unicode: g.unicode,
        components: g.components,
        alternateOf: g.alternateOf,
        leftBearing: g.leftBearing,
        rightBearing: g.rightBearing,
        cellWidth: g.cellWidth,
        cellHeight: g.cellHeight,
        // Tagged here, not guessed at export time: a jamo is calibrated
        // against the em square rather than the baseline, and that is true
        // whether or not anyone ever composes a syllable from it.
        ...(isHangulChar(g.name) ? { script: "hangul" as const } : {}),
        // Midpoint-quadratic smoothing is right for freehand ink (dense
        // point clouds, where it reproduces the drawn curve) and wrong for
        // nib hulls and stamps (sparse exact polygons, where it rounds off
        // corners that were deliberate). The union can mix rings from both,
        // so the decision is per glyph: any non-freehand ink in it and the
        // whole glyph emits straight edges. Calligraphy strokes don't count
        // as such ink — they bypass the brush entirely (see outlineFor), and
        // their sampled half-oval end caps are exactly what the smoothing is
        // there to round. A glyph made only of Vector-tool shapes has no
        // brushed ink at all and keeps the smoothing too, which is what its
        // dense curve flattening expects.
        contours: rings.map((ring) =>
          pathToSvgD(
            glyphStrokes.some((s) => s.kind !== "calligraphy") && settings.brush.kind !== "freehand"
              ? outlineToSharpPath(ring)
              : outlineToPath(ring)
          )
        ),
      };
    }),
  };
}

// Grid View's cell height as a multiple of cellSize. Latin cells are 16:9
// portrait so ascenders and descenders have room above and below the
// x-height; a Hangul cell is the em square, because a syllable is composed
// inside one. Per script rather than one constant — see SCRIPTS in
// src/lib/charsets.ts.
function cellAspectFor(script: ScriptId): number {
  return scriptById(script).aspect;
}

// A context variant is drawn in a cell shaped like the slot it will fill: the
// batchim cell is a wide band, the beside-a-vertical-vowel cell is tall and
// narrow. That is the entire mechanism by which variants keep their stroke
// weight — composition maps cell to slot, so a cell already shaped like the
// slot needs no squeezing. Draw a batchim in a square cell and you're back to
// shrinking a drawing to fit, which is what variants exist to stop.
// Returns the cell's size in CSS px for a slot. A variant cell is cellSize
// times its slot's own fractions of the em, so every variant cell maps onto
// its slot by the same factor — see JamoVariant.
function cellSizeForSlot(
  name: string,
  script: ScriptId,
  cellSize: number,
  widthRatio: number
): { width: number; height: number } {
  const variant = allVariantSlots().find((v) => v.name === name);
  if (variant) return { width: cellSize * variant.w, height: cellSize * variant.h };
  return { width: cellSize * widthRatio, height: cellSize * cellAspectFor(script) };
}

// Note on "aspect 1" for Hangul: it makes the cell's OUTER box square, so the
// drawing area underneath is a little shorter than it is wide (the label bar
// takes ~21px). Adding that back — making the canvas itself square — was
// tried and reverted: cellWidth/cellHeight are recorded per glyph at draw
// time, and fromAnchorSpace() rescales each axis independently, so changing
// the canvas height retroactively stretches every jamo already drawn. The em
// box (src/lib/hangul.ts) is inset within the canvas instead, which gives the
// air without touching anyone's existing drawings.

// Free mode's background: plain, evenly-spaced ruled lines, not tied to any
// glyph metrics — just a spatial reference the user can space out via one
// slider. (An earlier version reused Grid View's Ascender/X-height/Baseline/
// Descender guides here, but four differently-styled lines per row read as
// confusing when there's no per-glyph cell to anchor them to.)
function drawLineRaster(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
  panX: number,
  panY: number
) {
  if (spacing <= 0) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = FREE_RASTER_COLOR;
  ctx.beginPath();
  // Lines are drawn in the already ctx.translate(panX, panY)'d space (see
  // redraw()), so the on-screen viewport actually spans local y from -panY
  // to height - panY — not [0, height] — once the user has panned. Looping
  // over the untranslated canvas rect left the raster behind after a big
  // enough pan; this keeps it tiled across whatever's actually visible.
  const firstY = Math.floor(-panY / spacing) * spacing;
  const lastY = height - panY;
  for (let y = firstY; y <= lastY; y += spacing) {
    const ly = Math.round(y) + 0.5;
    ctx.moveTo(-panX, ly);
    ctx.lineTo(width - panX, ly);
  }
  ctx.stroke();
  ctx.restore();
}

// Trace image import limits. redraw() runs on every pointermove, so an
// oversized photo is rasterized down ONCE at import time — drawImage from a
// multi-thousand-pixel source on every frame visibly drags stroke latency.
// The file-size cap just rejects obviously wrong picks (a print-resolution
// scan, a camera RAW export) before the browser spends time decoding them.
const TRACE_MAX_DIMENSION = 2048;
const TRACE_MAX_FILE_BYTES = 20 * 1024 * 1024;
// Formats every canvas-capable browser can decode natively. Notably absent:
// HEIC/HEIF (iPhone default) — browsers can't decode it, so it fails in
// img.onerror with the format hint below rather than silently.
const TRACE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

function strokeLassoPath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLOR_TAGGED;
  ctx.stroke();
  ctx.restore();
}

// The brush cursor: what a single tap would leave with the CURRENT settings,
// centered on the pointer — reuses the exact same outlineFor() a real stroke
// goes through, so the ring is never an approximation of size/ratio/angle,
// it's the true shape. A small center dot stays visible even when the brush
// itself is too thin to read as a ring.
function drawBrushCursor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  settings: StrokeSettings,
  kind: StrokeKind
) {
  const tap: StrokePoint = [cx, cy, 1];
  const outline = outlineFor([tap], settings, kind).polygons[0];
  ctx.save();
  if (outline && outline.length > 2) {
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
    ctx.closePath();
    ctx.strokeStyle = ANCHOR_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = ANCHOR_COLOR;
  ctx.fill();
  ctx.restore();
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fffInputRef = useRef<HTMLInputElement | null>(null);
  const traceInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);
  // Wall-clock start of the current drag gesture — the one piece of timing
  // info a completed Stroke's points don't carry themselves, needed for the
  // provenance event's durationMs (see src/lib/provenance.ts).
  const strokeStartTimeRef = useRef(0);

  // Completed strokes + their cached outlines (recomputed only when a stroke is added
  // or settings change — not on every pointer move).
  const completedRef = useRef<Stroke[]>([]);
  const outlinesRef = useRef<BrushOutput[]>([]);
  const currentPointsRef = useRef<StrokePoint[]>([]);
  const lassoRef = useRef<[number, number][]>([]);
  // True for the duration of a gesture that started with Cmd/Ctrl held over a
  // CMD_SELECT_OVERRIDE_TOOLS tool — decided once at pointerdown so a
  // mid-drag modifier release can't switch a lasso into a half-drawn stroke.
  const cmdSelectRef = useRef(false);
  const redrawRef = useRef<() => void>(() => {});
  // Grid became the default view, so Free's canvas can mount hidden
  // (display:none) — its getBoundingClientRect() is 0x0 then, and stays
  // that way (a stale 0x0 backing store, no visible raster/strokes) until
  // something re-measures it. window's own "resize" event never fires just
  // because a view switch changed display, so the effect below calls this
  // explicitly the moment drawStyle actually becomes "free".
  const resizeRef = useRef<() => void>(() => {});
  // Undo/Redo is a full snapshot stack (strokes + glyphs together, since a
  // deletion/reshape can also create/orphan a glyph) — not just "remove the
  // last added stroke," which is all the previous model could do. That
  // meant Eraser/Delete-key/Nudge/Move/Rotate/Scale were all immediate and
  // permanent; every one of those now pushes a pre-mutation snapshot here
  // instead, so any of them can be undone the same way a new stroke can.
  const undoStackRef = useRef<{ strokes: Stroke[]; glyphs: Glyph[] }[]>([]);
  const redoStackRef = useRef<{ strokes: Stroke[]; glyphs: Glyph[] }[]>([]);
  const glyphsRef = useRef<Glyph[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  const [topMode, setTopMode] = useState<TopMode>("draw");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>("grid");

  // ?view=free|editor|grid deep-links into a specific view on load — added
  // so the Writer page's own view tabs (a separate route, not part of this
  // SPA) can send you into Sketcher/Typer specifically instead of always
  // landing on the Grid default. Read once on mount only (client-only, so no
  // hydration concern — the very first render is identical either way, this
  // just fires a state update a tick later like any other one-time effect
  // here), then the param is stripped so a later reload doesn't re-force it
  // over whatever view you've since switched to.
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("view");
    const match = VIEW_DEFS.find((v) => v.key === key);
    if (!match) return;
    setTopMode(match.topMode);
    if (match.drawStyle) setDrawStyle(match.drawStyle);
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }, []);

  // Menu bar dropdown (Fontane/File/Edit/View/Tools) — dismissed by the
  // outside-click listener below.
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  // Hover-to-open for the menu bar: a short close delay (not an instant
  // setOpenMenu(null) on mouseleave) so the pointer can travel from the
  // trigger down into the dropdown panel across the small visual gap
  // between them without it flickering shut mid-move. Any new hover — the
  // same item again, or a different one — cancels a pending close.
  const menuHoverCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openMenuOnHover(key: MenuKey) {
    if (menuHoverCloseTimeoutRef.current !== null) {
      clearTimeout(menuHoverCloseTimeoutRef.current);
      menuHoverCloseTimeoutRef.current = null;
    }
    setOpenMenu(key);
  }
  function scheduleMenuHoverClose() {
    menuHoverCloseTimeoutRef.current = setTimeout(() => {
      setOpenMenu(null);
      menuHoverCloseTimeoutRef.current = null;
    }, 200);
  }
  // Toolbar tool-group flyouts (Illustrator's stacked tools) open two ways,
  // both deliberately slower than the menu bar's instant hover-open, since
  // these buttons sit right above the canvas where the pointer constantly
  // passes through en route to drawing:
  // - long-press (~300ms, Illustrator's own gesture): pointerdown arms a
  //   timer; if it fires before pointerup, the flyout opens AND the click
  //   that still fires on release must be swallowed — a completed
  //   long-press means "show me the stack", not "…and also activate".
  // - hover (~500ms): a discovery affordance for mouse users who'd never
  //   guess long-press; any leave before the timer fires cancels it, so
  //   merely crossing the toolbar never pops a flyout.
  const flyoutLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutLongPressFiredRef = useRef(false);
  const flyoutHoverOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelFlyoutLongPress() {
    if (flyoutLongPressTimeoutRef.current !== null) {
      clearTimeout(flyoutLongPressTimeoutRef.current);
      flyoutLongPressTimeoutRef.current = null;
    }
  }
  function armFlyoutLongPress(key: MenuKey) {
    cancelFlyoutLongPress();
    flyoutLongPressFiredRef.current = false;
    flyoutLongPressTimeoutRef.current = setTimeout(() => {
      flyoutLongPressTimeoutRef.current = null;
      flyoutLongPressFiredRef.current = true;
      setOpenMenu(key);
    }, 300);
  }
  function cancelFlyoutHoverOpen() {
    if (flyoutHoverOpenTimeoutRef.current !== null) {
      clearTimeout(flyoutHoverOpenTimeoutRef.current);
      flyoutHoverOpenTimeoutRef.current = null;
    }
  }
  function scheduleFlyoutHoverOpen(key: MenuKey) {
    // Re-entering the slot (or its open flyout) cancels a pending
    // hover-close, same as openMenuOnHover does for the menu bar.
    if (menuHoverCloseTimeoutRef.current !== null) {
      clearTimeout(menuHoverCloseTimeoutRef.current);
      menuHoverCloseTimeoutRef.current = null;
    }
    cancelFlyoutHoverOpen();
    flyoutHoverOpenTimeoutRef.current = setTimeout(() => {
      flyoutHoverOpenTimeoutRef.current = null;
      setOpenMenu(key);
    }, 500);
  }
  // Info/How-to modal, opened from the Fontane menu — a plain overlay
  // rather than another dropdown, since this content is paragraph-length,
  // not a short action list.
  const [infoModal, setInfoModal] = useState<"info" | "howto" | null>(null);
  // Ref twin for the mount-once keyboard effect below — its Esc/Enter
  // end-vector-session branch must yield to the modal's own Escape closer.
  const infoModalRef = useRef<"info" | "howto" | null>(null);
  useEffect(() => {
    infoModalRef.current = infoModal;
  }, [infoModal]);
  // File > New File's "save first?" confirmation — same modal pattern as
  // infoModal, just a yes/no instead of paragraph content.
  const [confirmNewFile, setConfirmNewFile] = useState(false);

  // Marketplace: Publish Font / Share Font both live in the same lightweight
  // modal pattern as infoModal. Publish's fields reset via
  // closeMarketplaceModal() below rather than persisting across opens.
  const [marketplaceModal, setMarketplaceModal] = useState<"publish" | "share" | null>(null);
  const [publishName, setPublishName] = useState("");
  const [publishAuthorName, setPublishAuthorName] = useState("");
  const [publishAuthorUrl, setPublishAuthorUrl] = useState("");
  const [slugCheck, setSlugCheck] = useState<{ slug: string; available: boolean } | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [shareResults, setShareResults] = useState<{ slug: string; display_name: string }[]>([]);
  const [shareSearching, setShareSearching] = useState(false);
  const [shareCopyState, setShareCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareCopiedSlug, setShareCopiedSlug] = useState<string | null>(null);

  // Cloud project save/load — gated by a real signed-in account (Supabase
  // Auth session, cookie-based via src/lib/supabaseBrowser.ts +
  // src/lib/supabaseServer.ts) instead of the old shared betacode. `user`
  // starts null and is filled in by the getSession()/onAuthStateChange
  // effect below — it's the actual source of truth, not a persisted local
  // value, since the session itself already lives in a cookie.
  // currentCloudProject still persists to localStorage (lazy initializer)
  // since a Load reloads the page, same as the local FFF Import flow.
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [currentCloudProject, setCurrentCloudProject] = useState<{ id: number; name: string } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("fontane.currentCloudProject.v1");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [cloudModal, setCloudModal] = useState<"auth" | "save" | "projects" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authInviteCode, setAuthInviteCode] = useState("");
  const [cloudSaveAsName, setCloudSaveAsName] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudProjects, setCloudProjects] = useState<{ id: number; name: string; updated_at: string }[]>([]);
  const [cloudProjectsLoading, setCloudProjectsLoading] = useState(false);

  // Debounced live availability check while typing a name in the Publish
  // modal — UX feedback only, api/fonts/publish re-checks server-side before
  // actually writing anything (see that route's comment).
  useEffect(() => {
    if (marketplaceModal !== "publish") return;
    const trimmed = publishName.trim();
    if (!trimmed) {
      // Must clear a stale "available" result synchronously here (not just
      // let the debounced fetch below overwrite it) — handlePublish() reads
      // slugCheck?.available as its guard, so an empty name that still held
      // a prior success would otherwise stay publishable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlugCheck(null);
      setSlugChecking(false);
      return;
    }
    setSlugChecking(true);
    const handle = setTimeout(() => {
      fetch(`/api/fonts/check-slug?name=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => setSlugCheck(data.error ? null : { slug: data.slug, available: data.available }))
        .catch(() => setSlugCheck(null))
        .finally(() => setSlugChecking(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [publishName, marketplaceModal]);

  // Debounced search backing the Share Font modal.
  useEffect(() => {
    if (marketplaceModal !== "share") return;
    const trimmed = shareQuery.trim();
    if (!trimmed) {
      // Clears stale results synchronously so a cleared search box can't
      // still show the previous query's matches for a frame.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShareResults([]);
      setShareSearching(false);
      return;
    }
    setShareSearching(true);
    const handle = setTimeout(() => {
      fetch(`/api/fonts/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => setShareResults(data.results ?? []))
        .catch(() => setShareResults([]))
        .finally(() => setShareSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [shareQuery, marketplaceModal]);

  // Fetches the cloud project list whenever "My Cloud Projects" opens — not
  // debounced (no text input driving it), just a one-shot load per open.
  // No auth header needed: the session cookie rides along on every
  // same-origin fetch automatically.
  useEffect(() => {
    if (cloudModal !== "projects" || !user) return;
    setCloudProjectsLoading(true);
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setCloudProjects(data.projects ?? []))
      .catch(() => setCloudProjects([]))
      .finally(() => setCloudProjectsLoading(false));
  }, [cloudModal, user]);

  // The one place session state gets read: an initial getSession() (so a
  // page reload doesn't flash "signed out" before the cookie's been
  // checked) plus a live subscription for sign-in/sign-out/token-refresh
  // happening in this same tab. supabaseBrowser's client persists its own
  // subscription internally — this only mirrors its current user into
  // component state for the UI to read.
  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? null } : null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Persisted, unlike every other version of this state before it: switching
  // a script on is a decision about what font this is, not a view toggle, and
  // losing it on reload reads as "my Hangul cells are gone" even though the
  // drawings are all still there.
  const [activeSetIds, setActiveSetIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_CHARACTER_SET_IDS);
    try {
      const raw = window.localStorage.getItem("fontane.activeSets.v1");
      const parsed = raw ? (JSON.parse(raw) as string[]) : null;
      // Drop ids that no longer exist rather than carrying phantom sets
      // forward; an empty result falls back to the default.
      const known = parsed?.filter((id) => CHARACTER_SETS.some((s) => s.id === id)) ?? [];
      return new Set(known.length ? known : DEFAULT_CHARACTER_SET_IDS);
    } catch {
      return new Set(DEFAULT_CHARACTER_SET_IDS);
    }
  });

  // Which script's cells the Grid is showing. Only meaningful when more than
  // one script is switched on — see activeScripts() in charsets.ts.
  const [activeScript, setActiveScript] = useState<ScriptId>(DEFAULT_SCRIPT);
  // Extra Grid cells beyond the fixed character sets — this is the only way
  // to get a ligature/alternate slot into Grid view at all (Free mode's
  // Assign panel already supports both kinds via lasso-tagging; Grid drawing
  // fuses capture+tagging per cell, so it needs its own slot list instead).
  const [extraGridSlots, setExtraGridSlots] = useState<GridSlot[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("fontane.extraGridSlots.v1");
      return raw ? (JSON.parse(raw) as GridSlot[]) : [];
    } catch {
      return [];
    }
  });

  function addGridSlot(slot: GridSlot) {
    // A "base" name already covered by an active fixed set would collide
    // with that set's own cell (same kind+name → same React key, same
    // glyph lookup) — silently skip rather than render a duplicate cell.
    const collidesWithFixedSet =
      slot.kind === "base" && CHARACTER_SETS.some((s) => activeSetIds.has(s.id) && s.chars.includes(slot.name));
    if (collidesWithFixedSet) return;
    setExtraGridSlots((prev) => {
      if (prev.some((s) => s.name === slot.name && s.kind === slot.kind)) return prev;
      const next = [...prev, slot];
      window.localStorage.setItem("fontane.extraGridSlots.v1", JSON.stringify(next));
      return next;
    });
  }

  // Only removes the cell from Grid's visible slot list — the underlying
  // Glyph and its strokes (if any were drawn) are untouched, so re-adding
  // the same name+kind later picks up right where it left off.
  function removeGridSlot(name: string, kind: GlyphKind) {
    setExtraGridSlots((prev) => {
      const next = prev.filter((s) => !(s.name === name && s.kind === kind));
      window.localStorage.setItem("fontane.extraGridSlots.v1", JSON.stringify(next));
      return next;
    });
  }

  const [metrics, setMetrics] = useState<Metrics>(() => loadMetrics());

  // Zoom, not cell size.
  //
  // A glyph records the cell it was drawn in, and display rescales it — points
  // AND stroke width — to whatever the cell measures now. So as long as the
  // drawing space could be resized, the size of that space at drawing time
  // silently fixed the letter's weight relative to itself: two letters drawn
  // at 80 and at 210 keep a 2.6x weight difference for good, through every
  // export, from a slider that never mentions weight.
  //
  // Everything is now drawn in ONE space, CANONICAL_CELL, and the slider only
  // changes how large that space is displayed. The anchor machinery
  // (toAnchorSpace/fromAnchorSpace) already did the arithmetic a zoom needs —
  // it was just being told a different answer per glyph. One answer for
  // everyone, and a second stroke weight has nowhere to come from.
  const [zoom, setZoom] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_ZOOM;
    // Carry the old preference over: someone who had cells at 210 keeps
    // seeing them that big, it is just no longer what their letters are
    // measured in.
    const legacy = Number(
      window.localStorage.getItem("fontane.cellSize.v1") ?? window.localStorage.getItem("glypher.cellSize.v1")
    );
    const stored = Number(window.localStorage.getItem("fontane.gridZoom.v1"));
    if (stored > 0) return stored;
    return legacy > 0 ? clampZoom(legacy / CANONICAL_CELL) : DEFAULT_ZOOM;
  });

  // What a cell measures on screen right now. Kept under the old name because
  // every consumer of it — cellSizeForSlot, the width handle, the variant
  // cells — wants exactly this: displayed pixels.
  const cellSize = Math.round(CANONICAL_CELL * zoom);

  function updateZoom(next: number) {
    const z = clampZoom(next);
    setZoom(z);
    window.localStorage.setItem("fontane.gridZoom.v1", String(z));
  }

  // A ratio, not an absolute pixel value — wide letters like "m" or "@" need
  // more horizontal room than tall/narrow ones, but letting width and height
  // be two fully independent absolute sizes made cells too easy to stretch
  // into arbitrary, hard-to-control shapes. Width stays a proportion of
  // cellSize instead, so "Cell size" alone still scales the whole cell
  // proportionally, and this only adjusts how wide relative to that.
  const [cellWidthRatio, setCellWidthRatio] = useState(() => {
    if (typeof window === "undefined") return 1;
    return Number(window.localStorage.getItem("fontane.cellWidthRatio.v1") ?? window.localStorage.getItem("glypher.cellWidthRatio.v1")) || 1;
  });

  function updateCellWidthRatio(ratio: number) {
    setCellWidthRatio(ratio);
    window.localStorage.setItem("fontane.cellWidthRatio.v1", String(ratio));
  }

  // When on, fromAnchorSpace/toAnchorSpace rescale a Grid glyph uniformly
  // (the smaller of the two axis ratios, applied to both) instead of
  // independently per axis — so changing Cell size/Width never stretches or
  // squeezes an already-drawn glyph's own proportions.
  const [keepProportions, setKeepProportions] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.keepProportions.v1") === "true";
  });

  function updateKeepProportions(value: boolean) {
    setKeepProportions(value);
    window.localStorage.setItem("fontane.keepProportions.v1", String(value));
  }

  // Grid bearings locked: the bearing lines and the per-cell width handle stop
  // answering the pointer (see GridCell's lockBearings), so a stroke drawn over
  // one is just a stroke instead of a dragged sidebearing. Named for the
  // bearings specifically, not the guides in general: the metric lines
  // (baseline/x-height/ascender/descender) aren't draggable in a cell at all —
  // they come from the sliders — so bearings and the width handle are the only
  // things a lock has anything to say about. Drawing across a full Grid means
  // crossing those lines constantly — this is the switch for "I'm shaping
  // letters now, not spacing them". Read on first render rather
  // than defaulted-then-synced so a reload doesn't hand back an unlocked Grid
  // for a frame, which is exactly one frame of the accident it prevents.
  const [lockBearings, setLockBearings] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.lockBearings.v1") === "true";
  });

  function updateLockBearings(value: boolean) {
    setLockBearings(value);
    window.localStorage.setItem("fontane.lockBearings.v1", String(value));
  }

  // Faint Comic-Sans backdrop letterform behind each Grid cell's guides — an
  // orientation aid for anyone unsure of a character's basic anatomy before
  // drawing their own design over it (see src/lib/referenceGlyph.ts). Defaults
  // on: unlike lockBearings, there's no accident this prevents, so there's no
  // reason to make new users opt in before they even know it exists.
  const [showReferenceGlyph, setShowReferenceGlyph] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("fontane.showReferenceGlyph.v1") !== "false";
  });

  function updateShowReferenceGlyph(value: boolean) {
    setShowReferenceGlyph(value);
    window.localStorage.setItem("fontane.showReferenceGlyph.v1", String(value));
  }

  // Each GridCell's own actual rendered size, keyed by letter — the label
  // bar under the canvas eats some of the grid row's nominal height (see
  // GridCell's onResize), so cellWidth/cellHeightPx alone don't match what a
  // cell's canvas really measures. Falls back to the nominal values below
  // until a cell has reported in at least once (first paint).
  const [cellDims, setCellDims] = useState<Record<string, { width: number; height: number }>>({});

  function handleCellResize(cellKey: string, width: number, height: number) {
    setCellDims((prev) => {
      const existing = prev[cellKey];
      if (existing && existing.width === width && existing.height === height) return prev;
      return { ...prev, [cellKey]: { width, height } };
    });
  }

  // Free mode's ruled-line background — independent of Grid View's cellSize,
  // since the two rasters serve different purposes (a plain spatial
  // reference vs. per-glyph type metrics).
  const [lineSpacing, setLineSpacing] = useState(() => {
    if (typeof window === "undefined") return 75;
    return Number(window.localStorage.getItem("fontane.lineSpacing.v1") ?? window.localStorage.getItem("glypher.lineSpacing.v1")) || 75;
  });

  function updateLineSpacing(spacing: number) {
    setLineSpacing(spacing);
    window.localStorage.setItem("fontane.lineSpacing.v1", String(spacing));
  }

  const [editorText, setEditorText] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("fontane.editorText.v1") ?? window.localStorage.getItem("glypher.editorText.v1") ?? "";
  });

  function updateEditorText(text: string) {
    setEditorText(text);
    window.localStorage.setItem("fontane.editorText.v1", text);
  }

  const [editorFontSize, setEditorFontSize] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_EDITOR_FONT_SIZE_PT;
    return Number(window.localStorage.getItem("fontane.editorFontSize.v1") ?? window.localStorage.getItem("glypher.editorFontSize.v1")) || DEFAULT_EDITOR_FONT_SIZE_PT;
  });

  function updateEditorFontSize(pt: number) {
    setEditorFontSize(pt);
    window.localStorage.setItem("fontane.editorFontSize.v1", String(pt));
  }

  // Off by default — Editor's char-by-char composition already matches what
  // most tagged glyphs are (kind:"base"); substituting a run like "fi" for a
  // tagged ligature is a deliberate opt-in, not assumed.
  const [useLigatures, setUseLigatures] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.useLigatures.v1") === "true";
  });

  function updateUseLigatures(value: boolean) {
    setUseLigatures(value);
    window.localStorage.setItem("fontane.useLigatures.v1", String(value));
  }

  function toggleCharacterSet(id: string) {
    // Which sets get switched on beyond the default is the most direct
    // evidence of which glyph coverage is wanted, rather than which we
    // guessed — the set id only, never which glyphs were then drawn. Sent
    // from here rather than inside the updater below, which React may run
    // more than once per call.
    trackCharset(id, !activeSetIds.has(id));
    // Computed out here, not inside the updater: React may run an updater
    // more than once per call, and both the localStorage write and the
    // script follow below have to happen exactly once.
    const next = new Set(activeSetIds);
    const turnedOn = !next.has(id);
    if (turnedOn) next.add(id);
    else next.delete(id);
    setActiveSetIds(next);
    window.localStorage.setItem("fontane.activeSets.v1", JSON.stringify([...next]));

    // Follow the user to whatever they just switched on — turning on the
    // Jamo set and then still staring at Latin cells reads as the toggle
    // having done nothing. Switching one off can equally strand the Grid on
    // a script with no cells left, so fall back to whatever remains.
    const set = CHARACTER_SETS.find((s) => s.id === id);
    const scripts = activeScripts(next);
    if (turnedOn && set) setActiveScript(scriptOf(set));
    else if (!scripts.includes(activeScript)) setActiveScript(scripts[0] ?? DEFAULT_SCRIPT);
  }

  function updateMetric(key: keyof Metrics, value: number) {
    setMetrics((prev) => {
      const next = { ...prev, [key]: value };
      saveMetrics(next);
      return next;
    });
  }

  const topModeRef = useRef(topMode);
  const drawStyleRef = useRef(drawStyle);
  // The view label every analytics event is tagged with — the same string
  // useVisitTracking() reports below, so per-view time and per-view tool use
  // are always talking about the same thing. Assigned during render (like
  // undoRef further down) rather than in an effect: a tool used in the same
  // tick as a view switch must land in the view it actually happened in.
  const viewLabelRef = useRef("studio:grid");
  viewLabelRef.current = topMode === "draw" ? `studio:${drawStyle}` : `studio:${topMode}`;
  // Editor has no stroke settings/tools of its own yet (Phase 1 is
  // read-only composition), and Writer has its own separate pen-size
  // control rather than the shared Draw/Vector/Brush toolbar — Free and
  // Grid still get the full Pen/Eraser/Nudge + stroke-appearance controls.
  const showStrokeControls = topMode === "draw" && drawStyle !== "editor" && drawStyle !== "writer";

  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const drawToolRef = useRef(drawTool);
  // Which member each Illustrator-style toolbar group (see ToolGroup) last
  // had active — the group's slot button wears this tool's face, exactly
  // like Illustrator's toolbar remembers whether the Pen slot shows Pen or
  // Delete Anchor. Written in ONE place, the [drawTool] effect below, so
  // keyboard shortcuts, the menu bar's Tools list, the flyouts, and
  // programmatic switches all move the slot face the same way. Initial
  // values are each group's first (headline) tool.
  const [activeByGroup, setActiveByGroup] = useState<Record<ToolGroup, DrawTool>>({
    penFamily: "vector",
    editFamily: "select",
    transform: "move",
  });

  // Nudge tool: which stroke is currently being reshaped, its anchor
  // indices (Douglas-Peucker-simplified — see src/lib/simplify.ts), whether
  // this session's stroke has already been resampled down to just those
  // anchors (only happens once, lazily, on the first anchor drag — see the
  // comment at the drag-start site), and which anchor is mid-drag. All refs,
  // not state: redraw() is called explicitly after every mutation here,
  // same as the rest of this canvas's pointer-driven state.
  const editingStrokeIdRef = useRef<string | null>(null);
  const anchorIndicesRef = useRef<number[]>([]);
  const resampledRef = useRef(false);
  const draggingAnchorRef = useRef<number | null>(null);

  // Anchor tool: a SINGLE anchor persistently selected (highlighted) on the
  // currently-edited stroke — unlike draggingAnchorRef above, this survives
  // pointerup, and is what Delete/Backspace acts on. Stores the anchor's
  // RANK (its position within anchorIndicesRef), not a raw point index —
  // rank stays meaningful across the lazy resample-to-anchors-only collapse
  // (which reorders storage but not which anchors exist or their order),
  // whereas a raw index captured before that resample would go stale.
  const selectedAnchorRef = useRef<{ strokeId: string; rank: number } | null>(null);

  // Vector tool: true Bezier shapes (src/lib/vectorShapes.ts), a completely
  // separate content type from Stroke. editingShapeIdRef is either a
  // still-open path being drawn for the first time (shape.closed === false)
  // or a previously-closed shape reopened for point edit — see
  // handleVectorPointerDown. draggingVectorAnchorRef/draggingHandleRef mirror
  // the Nudge tool's draggingAnchorRef: mutate + redraw() on every move,
  // persist via saveVectorShapes() only on pointerup.
  const vectorShapesRef = useRef<VectorShape[]>([]);
  const editingShapeIdRef = useRef<string | null>(null);
  // Set (with a drag-start position) when a click lands on an existing
  // anchor — moving beyond ANCHOR_HIT_PX before pointerup repositions it
  // instead of deleting it, same disambiguation as placingNewAnchorRef below.
  const draggingVectorAnchorRef = useRef<number | null>(null);
  const draggingHandleRef = useRef<{ anchorIndex: number; which: "handleIn" | "handleOut" } | null>(null);
  // True only while dragging the handle of an anchor just placed by this
  // same click (see handleVectorPointerDown) — that drag sets both handles
  // symmetrically (a smooth curve point) and collapses back to a plain
  // corner (no handles) if released without moving. Dragging an EXISTING
  // handle later (this flag false) adjusts just that one side.
  const placingNewAnchorRef = useRef(false);
  const vectorDragStartRef = useRef<{ x: number; y: number } | null>(null);

  // The settings palette's "Path" section — Glyphs' Info box parallel: a
  // read-only digest of the vector editing session (which canvas it lives
  // on, anchor count, open/closed, smooth-vs-corner split). Deliberately
  // React state, unlike everything else vector: it drives palette JSX, not
  // the canvas. Written ONLY at commit points (pointerdown/up, dblclick,
  // session end — see syncVectorPanelInfo callers), never on pointermove,
  // so drags don't re-render the page per frame.
  const [vectorPanelInfo, setVectorPanelInfo] = useState<{
    source: string;
    anchorCount: number;
    closed: boolean;
    smoothCount: number;
  } | null>(null);
  // Which of the editing shape's anchors the last Free-canvas pointerdown
  // landed on — the palette's "Toggle smooth" button needs a target anchor,
  // and "the one you last clicked" is Glyphs' own convention for it.
  const lastClickedAnchorIndexRef = useRef<number | null>(null);

  // Derives the Path section from the live Free-canvas session refs. Grid
  // cells report their own sessions via onVectorSessionChange instead —
  // their shapes live in cell-local pixel space, not in these refs.
  function syncVectorPanelInfo() {
    const shape = vectorShapesRef.current.find((s) => s.id === editingShapeIdRef.current);
    if (!shape) {
      setVectorPanelInfo(null);
      return;
    }
    setVectorPanelInfo({
      source: "Free",
      anchorCount: shape.anchors.length,
      closed: shape.closed,
      smoothCount: shape.anchors.filter(isSmoothAnchor).length,
    });
  }

  // Move/Rotate/Scale: a snapshot of every selected stroke's points taken at
  // gesture start, plus the pivot (bbox center) and start pointer position —
  // every pointermove recomputes from this frozen snapshot rather than the
  // live (already-mutated) points, same "read pre-drag state, write pointer
  // position" shape as Nudge's anchor drag above, just applied to a whole
  // selection instead of one anchor. null when no such gesture is active.
  const transformStartRef = useRef<{
    mode: "move" | "rotate" | "scale";
    pivotX: number;
    pivotY: number;
    startX: number;
    startY: number;
    startDist: number;
    startAngle: number;
    // Signed per-axis start offsets from the anchor — lets Scale compute
    // independent (non-uniform) x/y ratios; startDist/startAngle above stay
    // for Rotate and for Shift-locked (uniform) Scale.
    startDx: number;
    startDy: number;
    // Shift-locked at gesture start (see handleTransformPointerDown) rather
    // than re-read live, so toggling Shift mid-drag can't suddenly snap an
    // already-diverged non-uniform scale back to square.
    uniform: boolean;
    // Last scaleX/scaleY applied by applyTransform — read once at pointerup
    // to bake this gesture's magnitude into the scaled strokes' widthScale.
    lastScaleX: number;
    lastScaleY: number;
    snapshot: Map<string, StrokePoint[]>;
    // Updated every pointermove by applyTransform so redraw() can paint a
    // pivot dot + guide line without redraw() itself needing the live
    // pointer position passed in some other way.
    currentX: number;
    currentY: number;
  } | null>(null);

  // Pan: panOffsetRef is added to every drawn/read coordinate (see redraw()
  // and pointFromEvent()) so existing strokes appear to scroll; it's a ref,
  // not state, since it must update every pointermove frame without
  // triggering a React re-render. panDragStartRef captures the gesture's own
  // start in raw client coordinates (not world space) to avoid a feedback
  // loop with the offset it's busy mutating.
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const panDragStartRef = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);
  // Space = momentary pan (Illustrator's spacebar hand). A ref the pointer
  // handlers check FIRST, deliberately not setDrawTool("pan") — the
  // [drawTool] effect clears selection and ends editing sessions, exactly
  // what a momentary pan must not do. Reuses the pan refs above; only the
  // entry condition differs.
  const spacePanRef = useRef(false);
  // Last hover position in canvas space — lets an Alt/Meta press refresh the
  // hover-contextual pen cursor without waiting for the next pointermove.
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  // Last cursor string written to the canvas — the pen cursors are ~1KB
  // data-URI strings, so style.cursor is only rewritten when the value
  // actually changes, not on every pointermove.
  const lastCursorRef = useRef("");

  const [settings, setSettings] = useState<StrokeSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  // Drives Free mode's line raster (see drawLineRaster) — a ref, not a
  // direct state read, since the redraw() that consumes it lives inside
  // the mount-once pointer-handling effect below.
  const lineSpacingRef = useRef(lineSpacing);

  // Trace image: a reference photo/scan drawn dimmed underneath the line
  // raster in Free Draw so letterforms can be traced over it. Session-only
  // on purpose — a decoded photo re-encoded as a data URL would routinely
  // blow the ~5MB localStorage quota the strokes themselves live in. The
  // pixels live in a ref (redraw() runs inside the mount-once pointer
  // effect, same as lineSpacingRef); opacity/scale/offset each keep a small
  // state mirror so the settings panel re-renders.
  const traceImageRef = useRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
  const [traceImageInfo, setTraceImageInfo] = useState<{ name: string; width: number; height: number } | null>(
    null
  );
  const [traceOpacity, setTraceOpacity] = useState(40);
  const traceOpacityRef = useRef(40);
  const [traceScale, setTraceScale] = useState(100);
  const traceScaleRef = useRef(100);
  const [traceOffset, setTraceOffsetState] = useState({ x: 24, y: 24 });
  const traceOffsetRef = useRef({ x: 24, y: 24 });

  // Lazy initializer, not useEffect + setGlyphs([]) then load: starting from an empty
  // array and loading afterward would let the save-on-change effect below fire once
  // with [] and clobber whatever was already in storage before the real data arrives.
  const [glyphs, setGlyphs] = useState<Glyph[]>(() => loadGlyphs());

  // The context variants, after the basics: a consonant drawn again for the
  // place it actually sits, so composition can stop shrinking one drawing into
  // every slot. Every one of them is optional — an undrawn variant falls back
  // to the scaled basic, which is what the font does today.
  const variantSlots: GridSlot[] =
    activeScript === "hangul" && activeSetIds.has("hangul-jamo")
      ? allVariantSlots().map((v): GridSlot => ({ name: v.name, kind: "base" }))
      : [];

  // The practice sheet: whole syllables, drawn by hand, that the batchim
  // variants get lifted out of. A cell this size is the point — a fixed pen in
  // a 0.27-em box writes a relatively fat stroke, so the batchim can only be
  // drawn at its real density as part of something bigger.
  const syllableSlots: GridSlot[] =
    activeScript === "hangul" && activeSetIds.has("hangul-jamo")
      ? harvestSyllables().map((s): GridSlot => ({ name: s.char, kind: "base" }))
      : [];

  // Every glyph already tagged (e.g. via Free's Assign panel) gets its own
  // Grid cell automatically — no need to re-declare it via "Add Glyph" just
  // to see/edit it here. That includes base glyphs whose name no active
  // character set covers: a freely-named symbol like "Zeich_skull" (no
  // unicode, since the name isn't a single codepoint) otherwise existed only
  // in Free and was invisible in Grid. Base glyphs an active set DOES cover
  // are skipped — that set already contributes their cell, and a second one
  // would collide on the same key, the same reason addGridSlot() refuses
  // them. Deduped against extraGridSlots by name+kind so a manually-added
  // not-yet-drawn slot doesn't collide with the same slot once a glyph
  // starts existing for it (same key either way).
  const extraSlotKeys = new Set(extraGridSlots.map((s) => `${s.kind}:${s.name}`));
  const activeSetChars = new Set(
    CHARACTER_SETS.filter((s) => activeSetIds.has(s.id)).flatMap((s) => s.chars)
  );
  // Slots that aren't in any character set but are contributed above anyway —
  // the 14 practice syllables and the 42 variants. Without this a drawn 각 or
  // ㄱ.fin satisfies isHangulChar, so it came back a SECOND time as a tagged
  // slot: two live cells for one glyph, colliding on the same React key. It
  // went unnoticed while everything shared one long scroll; with steps the
  // twin lands on a different page from the original.
  const ownedSlotKeys = new Set(
    [...syllableSlots, ...variantSlots].map((s) => `${s.kind}:${s.name}`)
  );
  const taggedSlots: GridSlot[] = glyphs
    .filter(
      (g) =>
        !extraSlotKeys.has(`${g.kind}:${g.name}`) &&
        !ownedSlotKeys.has(`${g.kind}:${g.name}`) &&
        (g.kind !== "base" || !activeSetChars.has(g.name))
    )
    .map((g): GridSlot => ({ name: g.name, kind: g.kind, components: g.components, alternateOf: g.alternateOf }));

  // Cells are per script, not one flat wall: Latin and Hangul cells have
  // different proportions and different guides, so they can't share a grid
  // even when the same font contains both. Fixed sets carry their script
  // explicitly; user-created slots (tagged in Free, or added by hand) are
  // filed by what they're actually written in.
  const slotScript = (name: string): ScriptId => (isHangulChar(name) ? "hangul" : "latin");

  // The cells that come from a switched-on character set — the 24 jamo for
  // Hangul, A-Z and friends for Latin. Named rather than inlined because
  // gridGroups below has to point at this list's first cell specifically: it
  // used to read gridSlots[0], which meant "whatever happens to be first",
  // and putting the syllables in front would have labelled a syllable "Jamo".
  const setSlots: GridSlot[] = CHARACTER_SETS.filter(
    (s) => activeSetIds.has(s.id) && scriptOf(s) === activeScript
  )
    .flatMap((s) => s.chars)
    .map((name): GridSlot => ({ name, kind: "base" }));

  // Syllables first. They are the optional part — the 24 jamo are what covers
  // all 11.172 syllables — but they are where the stroke weight is set, and a
  // jamo drawn alone can only be scaled INTO its slot afterwards, weight and
  // all. Whatever is drawn first decides what everything else is measured
  // against, so it had better be the thing that isn't distorted.
  const gridSlots: GridSlot[] = [
    ...syllableSlots,
    ...setSlots,
    ...variantSlots,
    ...taggedSlots.filter((s) => slotScript(s.name) === activeScript),
    ...extraGridSlots.filter((s) => slotScript(s.name) === activeScript),
  ];

  // Same hydration guard as panelReady/firstStepReady below: activeSetIds is
  // read from localStorage in a lazy initializer, so the server renders the
  // default (Latin only) while a returning Hangul user's client render has
  // two scripts — and a tab row that exists on one side and not the other is
  // a hydration mismatch. Only the row is gated, not the cells: activeScript
  // starts at "latin" either way, so the cells themselves match.
  const [scriptsReady, setScriptsReady] = useState(false);
  useEffect(() => setScriptsReady(true), []);
  const gridScripts = scriptsReady ? activeScripts(activeSetIds) : [DEFAULT_SCRIPT];

  // Headings only where a wall of cells stops being self-explanatory: 66
  // Hangul cells in one flow give no clue where the basics end and which
  // context you're currently drawing. Latin keeps its single unlabelled grid.
  const gridGroups =
    variantSlots.length > 0
      ? [
          {
            id: "grp-syllables",
            label: "Syllables · draw these whole",
            example: "각",
            count: syllableSlots.length,
            first: syllableSlots[0]?.name,
          },
          { id: "grp-basic", label: "Jamo · the basics", example: "ㄱ", count: BASIC_JAMO.length, first: setSlots[0]?.name },
          ...JAMO_VARIANTS.map((v) => ({
            id: `grp-${v.role}`,
            label: v.label,
            example: v.example,
            count: BASIC_CONSONANTS.length,
            first: variantName(BASIC_CONSONANTS[0], v.role),
          })),
        ]
      : [];
  const gridHeadingFor = (name: string) => gridGroups.find((g) => g.first === name);

  // Scrolls the grid to a group heading. Deliberately not scrollIntoView:
  // that picks its own scroll container, and here it picked the window rather
  // than the grid's own overflow, landing the target at the bottom edge
  // instead of the top. Walking up to the real scroller and moving it by the
  // measured delta is exact. Instant rather than smooth — the batchim group is
  // ~1.600px down, and animating that far loses you.
  function scrollGroupIntoView(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    else el.scrollIntoView({ block: "start" });
  }

  // "18 of 24 jamo drawn -> 6.412 of 11.172 syllables covered" is the whole
  // Hangul pitch in one line, and the only progress number that means
  // anything here: cells drawn says little, syllables reachable says
  // everything. coverage() brute-forces all 11.172, so it's memoized on the
  // drawn set rather than run per render.
  const drawnJamoKey = glyphs
    .filter(
      (g) =>
        g.kind === "base" &&
        BASIC_JAMO.includes(g.name) &&
        (g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0)
    )
    .map((g) => g.name)
    .sort()
    .join("");
  const hangulCoverage = useMemo(() => coverage([...drawnJamoKey]), [drawnJamoKey]);
  const jamoDrawn = [...drawnJamoKey].length;
  // Variants are quality, not coverage — the syllable count must not move when
  // one is drawn, so they're counted separately and never fed to coverage().
  const variantNames = new Set(allVariantSlots().map((v) => v.name));
  const variantsDrawn = glyphs.filter(
    (g) => variantNames.has(g.name) && (g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0)
  ).length;
  // Same rule for the practice syllables, and the same reason: drawing 각 must
  // not move the 11.172 either — a syllable that composes is already covered.
  const syllableNames = new Set(syllableSlots.map((s) => s.name));
  const syllablesDrawn = glyphs.filter(
    (g) => syllableNames.has(g.name) && (g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0)
  ).length;

  // The grid as a sequence. Steps only exist where the groups do (Hangul with
  // the Jamo set on); everywhere else gridSteps is empty, visibleGridSlots IS
  // gridSlots, and nothing about Latin changes.
  //
  // The whole split is a filter on the render's INPUT — no per-group
  // containers, no restructured map. Everything downstream (gridHeadingFor,
  // cellSizeForSlot, scrollGroupIntoView) addresses cells by name, so it
  // neither knows nor cares that fewer of them are on screen.
  const gridSteps =
    gridGroups.length > 0
      ? HANGUL_STEPS.map((step) => ({
          ...step,
          slots:
            step.id === "step-syllables"
              ? syllableSlots
              : step.id === "step-variants"
                ? variantSlots
                : // The jamo step also carries anything hand-made: tagged
                  // glyphs and manually added slots are letters, and letters
                  // belong with the letters. That also keeps the union of all
                  // steps equal to gridSlots, which is the invariant that
                  // stops a cell from vanishing.
                  [
                    ...setSlots,
                    ...taggedSlots.filter((s) => slotScript(s.name) === activeScript),
                    ...extraGridSlots.filter((s) => slotScript(s.name) === activeScript),
                  ],
          done:
            step.id === "step-syllables" ? syllablesDrawn : step.id === "step-variants" ? variantsDrawn : jamoDrawn,
          total:
            step.id === "step-syllables"
              ? syllableSlots.length
              : step.id === "step-variants"
                ? variantSlots.length
                : BASIC_JAMO.length,
        }))
      : [];
  const recommendedStep = recommendedStepId(
    Object.fromEntries(gridSteps.map((s) => [s.id, { done: s.done, total: s.total }]))
  );
  // null = follow the recommendation. Clicking a chip pins it, so finishing a
  // step doesn't yank the grid out from under someone who is still working in
  // it. Deliberately not persisted, like topMode/drawStyle/activeScript: the
  // recommendation is a better landing place than a step you already finished.
  const [gridStep, setGridStep] = useState<string | null>(null);
  const activeStep = gridSteps.find((s) => s.id === (gridStep ?? recommendedStep)) ?? gridSteps[0] ?? null;
  const visibleGridSlots = activeStep ? activeStep.slots : gridSlots;
  // Arriving at a new step halfway down the previous one's scroll shows a
  // random row of cells and no heading.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (gridScrollRef.current) gridScrollRef.current.scrollTop = 0;
  }, [activeStep?.id]);
  // First-run onboarding: with a totally empty project, the very first Grid
  // slot gets a highlight + hint bubble (see GridCell's firstStepHint) so
  // there's an obvious place to draw instead of 50+ equally-blank cells.
  // Naturally stops applying the moment any glyph exists anywhere — no
  // separate dismiss flag to maintain. Gated on firstStepReady for the same
  // reason the old character-set gate needed gridSetupGateReady: `glyphs`
  // loads from localStorage, empty on the server but already populated by
  // the client's first render, so reading glyphs.length directly here would
  // hydration-mismatch on any project that already has glyphs.
  const [firstStepReady, setFirstStepReady] = useState(false);
  useEffect(() => setFirstStepReady(true), []);
  const firstStepCellKey =
    firstStepReady && glyphs.length === 0 && visibleGridSlots.length > 0
      ? `${visibleGridSlots[0].kind}:${visibleGridSlots[0].name}`
      : null;
  const taggedIdsRef = useRef<Set<string>>(new Set());
  const taggedIdsVectorRef = useRef<Set<string>>(new Set());
  // Shapes whose owning glyph has no strokes at all — those ARE the letter and
  // get filled, everything else punches (see redraw()). Precomputed alongside
  // the tagged-id sets rather than derived per frame, same as taggedIdsRef.
  const vectorFillIdsRef = useRef<Set<string>>(new Set());
  // Strokes belonging to a Grid-native glyph (cellWidth/cellHeight set) live in
  // Grid-cell-local coordinate space, not Free-canvas space — Free's redraw()
  // must skip them or they paint as a stray blob near the Free canvas origin.
  const gridNativeStrokeIdsRef = useRef<Set<string>>(new Set());

  // Which typed characters in Editor mode have no tagged glyph yet — shown
  // in the dark settings panel alongside the Size control, not inside
  // EditorPanel itself (which only owns the canvas + its hidden input).
  const missingEditorGlyphs = useMemo(() => {
    const all = new Set<string>();
    // Empty editorText falls back to the same specimen pangram EditorPanel
    // itself renders in that case (see its displayText) — otherwise this
    // warning would silently miss whatever the canvas is actually showing.
    const textToCheck = editorText || EDITOR_SAMPLE_TEXT;
    for (const line of textToCheck.split("\n")) {
      for (const c of layoutText(line, glyphs, completedRef.current, metrics, useLigatures, vectorShapesRef.current)
        .missing)
        all.add(c);
    }
    return [...all];
  }, [editorText, glyphs, metrics, useLigatures]);

  // Collapsed by default — a couple dozen tagged glyphs otherwise pushes the
  // canvas most of the way off-screen. Not persisted: a fresh page load
  // always starts collapsed, same as any other "peek, then expand" panel.
  const [glyphListExpanded, setGlyphListExpanded] = useState(false);

  // Whole-panel collapse, separate from each SettingsSection's own
  // open/closed state — reuses the same id-→boolean store (uiPrefs.ts) under
  // its own key, so it persists across reloads exactly like a section would,
  // without uiPrefs needing to know panel-level collapse is a different kind
  // of thing.
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(() => loadSectionOpen("settingsPanel", true));
  function toggleSettingsPanel() {
    const next = !settingsPanelOpen;
    setSettingsPanelOpen(next);
    saveSectionOpen("settingsPanel", next);
  }
  // Same hydration guard as firstStepReady/gridSetupGateReady used to need:
  // the server always renders the true fallback (no localStorage), so
  // anyone who has actually collapsed the panel would otherwise mismatch on
  // reload. Rendering stays "open" for one tick, then snaps to the real
  // value once mounted — a tiny flash beats a console error every reload.
  const [panelReady, setPanelReady] = useState(false);
  useEffect(() => setPanelReady(true), []);
  const displaySettingsPanelOpen = panelReady ? settingsPanelOpen : true;

  // Coach marks tour: starts false on every render (server and client
  // alike, so no hydration guard needed here — nothing reads localStorage
  // until the effect below runs, client-only, after mount). Auto-launches
  // once, the very first time anyone lands on Grid with nothing drawn yet;
  // "Show tour again" in the View menu (see startTour) can always bring it
  // back regardless of that flag.
  const [tourActive, setTourActive] = useState(false);
  useEffect(() => {
    const seen = window.localStorage.getItem("fontane.seenCoachTour.v1") === "true";
    if (!seen && topMode === "draw" && drawStyle === "grid") setTourActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function finishTour() {
    setTourActive(false);
    window.localStorage.setItem("fontane.seenCoachTour.v1", "true");
  }
  function startTour() {
    setTourActive(true);
    setOpenMenu(null);
  }

  // Shown once, the first time Free Draw is ever opened — dismissed
  // permanently via localStorage, same pattern as every other one-time flag
  // in this file (not a real "first session" check, just "has Start ever
  // been clicked").
  const [freeDrawIntroDismissed, setFreeDrawIntroDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.seenFreeDrawIntro.v1") === "true";
  });

  function dismissFreeDrawIntro() {
    setFreeDrawIntroDismissed(true);
    window.localStorage.setItem("fontane.seenFreeDrawIntro.v1", "true");
  }

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());

  // Skew H/V: a live shear (not a drag gesture) applied to the current
  // selection around its bbox center. Both sliders recompute from ONE frozen
  // pre-skew snapshot each time (never from the already-sheared points), so
  // the two axes combine cleanly and repeated small slider ticks don't drift.
  // Snapshot is retaken (and both angles reset to 0) whenever the selection
  // itself changes — skew is always relative to "the selection as it is now".
  const [skewH, setSkewH] = useState(0);
  const [skewV, setSkewV] = useState(0);
  const skewSnapshotRef = useRef<{ pivotX: number; pivotY: number; snapshot: Map<string, StrokePoint[]> } | null>(
    null
  );
  const skewUndoPushedRef = useRef(false);

  const [animateText, setAnimateText] = useState("");
  const [animatePresetId, setAnimatePresetId] = useState<AnimationPresetId>(DEFAULT_PRESET_ID);

  const [nameInput, setNameInput] = useState("");
  const [kindInput, setKindInput] = useState<GlyphKind>("base");
  const [componentsInput, setComponentsInput] = useState("");
  const [alternateOfInput, setAlternateOfInput] = useState("");

  const [hud, setHud] = useState({ pointerType: "—", pressure: 0, x: 0, y: 0 });
  const [strokeCount, setStrokeCount] = useState(0);

  // What the current brush costs the exported font, in the two units that
  // actually constrain it — every point here becomes a point in the glyf
  // table. Derived at render rather than pushed into state from the settings
  // effect below: both inputs already re-render this component when they
  // change, and a stipple brush's cost is exactly the thing that shouldn't
  // arrive one render late. Skipped entirely for the freehand brush, which
  // can't run the count up and doesn't display it.
  const inkStats = useMemo(() => {
    if (settings.brush.kind === "freehand") return { contours: 0, points: 0 };
    let contours = 0;
    let points = 0;
    for (const stroke of completedRef.current) {
      const out = strokeOutline(stroke, settings);
      contours += out.polygons.length;
      points += inkPointCount(out);
    }
    return { contours, points };
    // strokeCount isn't read here — it stands in for completedRef's contents,
    // which a ref can't announce. It's the state that moves whenever a stroke
    // is added or deleted, so keying on it re-derives the count exactly when
    // the underlying set of strokes changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, strokeCount]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [exportJson, setExportJson] = useState("");
  const [exportDoc, setExportDoc] = useState<ReturnType<typeof compileDocument> | null>(null);

  // A handful of real syllables built from whatever jamo exist right now.
  // This is the payoff moment of the whole feature — the first time someone
  // sees their own handwriting in a character they never drew — so it runs
  // live off exportDoc rather than waiting for an export.
  //
  // Only a few at a time: composing all 2.350 on every stroke would be a
  // waste, and a wall of syllables says less than eight does.
  const [syllableSeed, setSyllableSeed] = useState(0);
  const syllablePreview = useMemo(() => {
    if (!exportDoc) return [];
    const source = jamoFrom(exportDoc);
    if (source.size === 0) return [];
    const candidates = frequentSyllables(400);
    const out: { char: string; contours: string[] }[] = [];
    // Walks from a seed-dependent offset and wraps, so "Other syllables"
    // moves through the list deterministically instead of re-rolling and
    // sometimes showing the same ones again.
    for (let i = 0; i < candidates.length && out.length < 8; i++) {
      const cp = candidates[(i + syllableSeed * 8) % candidates.length];
      const contours = composeSyllable(cp, source);
      if (contours) out.push({ char: String.fromCodePoint(cp), contours });
    }
    return out;
  }, [exportDoc, syllableSeed]);

  // What each drawn jamo keeps of its stroke weight once it is composed. The
  // honest counterpart to the Syllables step: a jamo drawn alone is fitted by
  // its ink into a slot, and the factor depends on its own shape as much as on
  // the slot — so it is a range per cell, and no single control can flatten it.
  // Reads the same compiled document the syllable preview does.
  const jamoWeightNotes = useMemo(() => {
    if (!exportDoc || activeScript !== "hangul") return new Map<string, string>();
    const source = jamoFrom(exportDoc);
    const out = new Map<string, string>();
    for (const [name, drawing] of source) {
      const range = composedScaleRange(name, drawing);
      if (!range) continue;
      const lo = Math.round(range.min * 100);
      const hi = Math.round(range.max * 100);
      out.set(name, lo === hi ? `composes at ${lo}%` : `composes at ${lo}–${hi}%`);
    }
    return out;
  }, [exportDoc, activeScript]);

  // What the current pen can carry at the foot of a syllable.
  //
  // The batchim band is the tightest place in the writing system, so it is the
  // one that decides the weight — a designer sets a face from its tightest
  // counter, and this is that counter. Without the number you find out which
  // batchim your pen cannot draw after you have drawn fourteen syllables at
  // that pen, which is the expensive way round.
  //
  // Relative to the DISPLAYED em, because that is what the pen is measured
  // against: a stroke drawn at zoom Z with pen P is stored as P / (canonical
  // cell x Z), so the fraction is the same arithmetic the anchor does.
  const penFit = useMemo(() => {
    if (activeScript !== "hangul") return null;
    const emPx = CANONICAL_CELL * zoom * EM_BOX_FRACTION;
    if (emPx <= 0) return null;
    const fraction = settings.size / emPx;
    const carries: string[] = [];
    const tooFatFor: string[] = [];
    for (const jamo of BASIC_CONSONANTS) {
      (batchimPenLimit(jamo) >= fraction ? carries : tooFatFor).push(jamo);
    }
    // The tightest of the ones that DON'T fit, named rather than averaged: a
    // single "would need 4.5%" reads as if every one of them did, when ㄷ is
    // happy at 10.8% and only ㅎ is that demanding.
    const tightest = [...tooFatFor].sort((a, b) => batchimPenLimit(a) - batchimPenLimit(b))[0];
    return { fraction, carries, tooFatFor, tightest, tightestLimit: tightest ? batchimPenLimit(tightest) : 0 };
  }, [activeScript, zoom, settings.size]);

  // How much weight to take out of a harvested batchim. Real Korean faces do
  // take a little out of a dense one so the syllable doesn't clot — 5-15% is
  // the range designers work in. 1 = none, which is the honest default: it is
  // a design decision, not a correction.
  const [batchimWeight, setBatchimWeight] = useState(1);

  // What could be lifted out of the syllables that are actually drawn. Also
  // the preview: every row here becomes one variant glyph, and seeing the
  // stroke counts before pressing anything is the only review this first
  // version offers.
  const harvestable = useMemo(() => {
    if (activeScript !== "hangul") return [] as { char: string; results: HarvestResult[] }[];
    const wanted = new Set(harvestSyllables().map((s) => s.char));
    const byId = new Map(completedRef.current.map((s) => [s.id, s]));
    return glyphs
      .filter((g) => wanted.has(g.name) && g.strokeIds.length > 0 && g.cellWidth && g.cellHeight)
      .map((g) => {
        const strokes = g.strokeIds.map((id) => byId.get(id)).filter((s): s is Stroke => Boolean(s));
        return {
          char: g.name,
          // CANONICAL_CELL, not the displayed cell size: a harvested glyph is
          // written straight to storage and has to land in the same space
          // every drawn glyph does, whatever the zoom happens to be.
          results: harvestSyllable(
            g.name,
            strokes,
            g.cellWidth as number,
            g.cellHeight as number,
            CANONICAL_CELL,
            undefined,
            batchimWeight
          ),
        };
      })
      .filter((h) => h.results.length > 0);
  }, [glyphs, activeScript, batchimWeight]);

  // Write the harvested parts out as variant glyphs.
  //
  // Replaces rather than appends: harvesting twice must not stack two copies
  // of the same batchim in one cell, and redrawing a syllable and harvesting
  // again should simply supersede what the last run produced.
  function harvestBatchim() {
    if (harvestable.length === 0) return;
    pushUndoSnapshot();
    const results = harvestable.flatMap((h) => h.results);
    const targets = new Set(results.map((r) => r.name));
    const sourceById = new Map(completedRef.current.map((s) => [s.id, s]));
    const supersededIds = new Set(
      glyphsRef.current.filter((g) => targets.has(g.name)).flatMap((g) => g.strokeIds)
    );
    const stamp = Date.now();
    const made: Stroke[] = [];
    const idsByName = new Map<string, string[]>();
    results.forEach((r, ri) => {
      r.strokes.forEach((s, si) => {
        const id = `harvest-${stamp}-${ri}-${si}`;
        made.push({
          id,
          points: s.points as StrokePoint[],
          createdAt: stamp,
          widthScale: s.widthScale,
          // The source stroke's tool travels with it — a calligraphy batchim
          // has to keep being inked by the nib, not the pen.
          ...(sourceById.get(s.id)?.kind ? { kind: sourceById.get(s.id)!.kind } : {}),
        });
        idsByName.set(r.name, [...(idsByName.get(r.name) ?? []), id]);
      });
    });
    completedRef.current = [...completedRef.current.filter((s) => !supersededIds.has(s.id)), ...made];
    outlinesRef.current = completedRef.current.map((s) => strokeOutline(s, settingsRef.current));
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    setGlyphs((gs) => [
      ...gs.filter((g) => !targets.has(g.name)),
      ...results.map(
        (r): Glyph => ({
          id: `${stamp}-${r.name}`,
          name: r.name,
          kind: "base",
          strokeIds: idsByName.get(r.name) ?? [],
          createdAt: stamp,
          leftBearing: DEFAULT_LEFT_BEARING,
          rightBearing: DEFAULT_RIGHT_BEARING,
          cellWidth: r.cellWidth,
          cellHeight: r.cellHeight,
          // Deliberately no unicode: "ㄱ.fin" is not a codepoint, so it gets
          // no cmap entry and can never be typed — it only ever appears
          // inside a composed syllable.
        })
      ),
    ]);
  }

  // Whether this script's letters currently carry DIFFERENT stroke weights
  // relative to their own size — which is what a reader sees, and what the
  // Cell size slider quietly causes.
  //
  // Rendered width is settings.size x widthScale x (currentCell / anchorCell),
  // so a glyph's weight relative to its cell is widthScale / anchorCell. Even
  // means that ratio matches everywhere. Testing the ratio rather than the
  // anchor is what lets the offer disappear once it has been taken up.
  const mixedDrawWeights = useMemo(() => {
    const byId = new Map(completedRef.current.map((s) => [s.id, s]));
    const seen = new Set<number>();
    for (const g of glyphs) {
      if (g.strokeIds.length === 0 || !g.cellWidth || !g.cellHeight) continue;
      if (slotScript(g.name) !== activeScript) continue;
      const anchor = Math.sqrt(g.cellWidth * g.cellHeight);
      for (const id of g.strokeIds) {
        const s = byId.get(id);
        if (!s) continue;
        seen.add(Math.round(((s.widthScale ?? 1) / anchor) * 1e5));
        if (seen.size > 1) return true;
      }
    }
    return false;
    // completedRef is a ref by design (strokes don't drive renders); glyphs
    // changing is what re-runs this, and every write to one writes the other.
  }, [glyphs, activeScript]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Pan only ever offsets what's drawn from here on — the grid
      // background pans together with the ink so it still reads as a
      // spatial reference instead of content sliding under a static grid.
      ctx.save();
      ctx.translate(panOffsetRef.current.x, panOffsetRef.current.y);
      // The trace image sits UNDER the line raster, not over it: the raster
      // is the baseline reference the traced letterforms get aligned to, so
      // its lines must stay visible on top of the photo.
      const trace = traceImageRef.current;
      if (trace) {
        ctx.save();
        ctx.globalAlpha = traceOpacityRef.current / 100;
        const k = traceScaleRef.current / 100;
        ctx.drawImage(
          trace.source,
          traceOffsetRef.current.x,
          traceOffsetRef.current.y,
          trace.width * k,
          trace.height * k
        );
        ctx.restore();
      }
      drawLineRaster(
        ctx,
        canvas.clientWidth,
        canvas.clientHeight,
        lineSpacingRef.current,
        panOffsetRef.current.x,
        panOffsetRef.current.y
      );
      const strokes = completedRef.current;
      const outlines = outlinesRef.current;
      for (let i = 0; i < strokes.length; i++) {
        if (gridNativeStrokeIdsRef.current.has(strokes[i].id)) continue;
        const color =
          strokes[i].id === editingStrokeIdRef.current
            ? COLOR_SELECTED
            : selectedIdsRef.current.has(strokes[i].id)
              ? COLOR_SELECTED
              : taggedIdsRef.current.has(strokes[i].id)
                ? COLOR_TAGGED
                : COLOR_DEFAULT;
        fillOutline(ctx, outlines[i], color);
      }
      // Finished (closed) Vector-tool shapes, grouped by the glyph they're
      // tagged into so each group can follow the same rule compileDocument()
      // compiles: a group whose glyph has no strokes IS the letter and fills
      // (hazelnut, so the blueberry outlines and grape handles stay legible on
      // top of it); every other group — including shapes not tagged to
      // anything yet — punches out of whatever's already on the canvas, the
      // cheap live approximation of the real polygon difference. Each group is
      // one path filled "evenodd", so a counter drawn inside an outline stays
      // a counter instead of filling solid (the B/O/A case). An open,
      // still-being-drawn path has no fill yet, same as any other pen tool.
      const closedShapes = vectorShapesRef.current.filter(
        (s) => s.closed && s.anchors.length >= 2 && shapeRenderMode(s) !== "stroke"
      );
      if (closedShapes.length > 0) {
        const fills: VectorShape[] = [];
        const punches: VectorShape[] = [];
        for (const shape of closedShapes) {
          (vectorFillIdsRef.current.has(shape.id) ? fills : punches).push(shape);
        }
        const paint = (group: VectorShape[], punch: boolean) => {
          if (group.length === 0) return;
          ctx.save();
          ctx.beginPath();
          for (const shape of group) applyVectorShapePath(ctx, shape);
          if (punch) ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = punch ? "black" : VECTOR_FILL_COLOR;
          ctx.fill("evenodd");
          ctx.restore();
        };
        paint(fills, false);
        paint(punches, true);
      }
      // Stroke-mode shapes (open or closed) are ink, not a fill/punch — same
      // constant-width outline geometry the export path computes (see
      // vectorShapeStrokeOutline), painted like an ordinary stroke. A closed
      // shape's stroke is an outer ring PLUS an inner hole ring that must
      // fill together as one evenodd path (not one fill() per ring, which
      // would just paint the hole solid too) — same reasoning as the
      // fill/punch pass above, just scoped to one shape at a time so two
      // overlapping stroke shapes still ADD ink instead of cancelling it out.
      for (const shape of vectorShapesRef.current) {
        if (shape.anchors.length < 2 || shapeRenderMode(shape) !== "stroke") continue;
        const polygons = vectorShapeStrokeOutline(shape, shapeStrokeWidth(shape)).filter((p) => p.length >= 3);
        if (polygons.length === 0) continue;
        const color = selectedIdsRef.current.has(shape.id) ? COLOR_SELECTED : COLOR_DEFAULT;
        ctx.beginPath();
        for (const polygon of polygons) applyPath(ctx, outlineToPath(polygon));
        ctx.fillStyle = color;
        ctx.fill("evenodd");
      }
      if (!LASSO_TOOLS.has(drawToolRef.current) && !cmdSelectRef.current && currentPointsRef.current.length > 0) {
        fillOutline(
          ctx,
          outlineFor(currentPointsRef.current, settingsRef.current, strokeKindFor(drawToolRef.current)),
          COLOR_DEFAULT
        );
      }
      if ((LASSO_TOOLS.has(drawToolRef.current) || cmdSelectRef.current) && lassoRef.current.length > 1) {
        strokeLassoPath(ctx, lassoRef.current);
      }
      if (TRANSFORM_TOOLS.has(drawToolRef.current) && transformStartRef.current) {
        // A minimal MVP affordance for Rotate/Scale's otherwise-invisible
        // pivot — a dot at the bbox center plus a dashed line out to the
        // cursor — rather than a full bounding-box-with-handles UI this app
        // has never had. Shown for Move too, for visual consistency across
        // all three transform tools even though Move doesn't use the angle/
        // distance the line implies.
        const t = transformStartRef.current;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = SKELETON_GUIDE_COLOR;
        ctx.beginPath();
        ctx.moveTo(t.pivotX, t.pivotY);
        ctx.lineTo(t.currentX, t.currentY);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(t.pivotX, t.pivotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = ANCHOR_COLOR;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(t.pivotX, t.pivotY, 4, 0, Math.PI * 2);
        ctx.strokeStyle = ANCHOR_RING_COLOR;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      if ((drawToolRef.current === "nudge" || drawToolRef.current === "anchor") && editingStrokeIdRef.current) {
        const stroke = strokes.find((s) => s.id === editingStrokeIdRef.current);
        if (stroke) {
          // The literal "core path" — the raw pen centerline, not the filled
          // perfect-freehand outline — rendered live for the first time
          // anywhere in the app (previously only ever consumed by the
          // static Skeleton SVG export).
          ctx.save();
          ctx.beginPath();
          applyPath(ctx, skeletonToPath(stroke.points.map((p) => [p[0], p[1]] as [number, number])));
          ctx.strokeStyle = SKELETON_GUIDE_COLOR;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          anchorIndicesRef.current.forEach((idx, rank) => {
            const [ax, ay] = stroke.points[idx];
            const isSelectedAnchor =
              selectedAnchorRef.current?.strokeId === stroke.id && selectedAnchorRef.current?.rank === rank;
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.fillStyle = isSelectedAnchor ? COLOR_SELECTED : ANCHOR_COLOR;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.strokeStyle = ANCHOR_RING_COLOR;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          });
        }
      }
      if (VECTOR_TOOLS.has(drawToolRef.current)) {
        const editingShape = vectorShapesRef.current.find((s) => s.id === editingShapeIdRef.current);
        // A finished (closed) shape not currently being edited still gets its
        // outline stroked (not just the destination-out fill above) so it
        // reads as a distinct, clickable object rather than only a hole.
        for (const shape of vectorShapesRef.current) {
          if (shape.id === editingShapeIdRef.current) continue;
          ctx.save();
          ctx.beginPath();
          applyVectorShapePath(ctx, shape);
          ctx.strokeStyle = VECTOR_OUTLINE_COLOR;
          ctx.lineWidth = VECTOR_LINE_WIDTH;
          ctx.stroke();
          ctx.restore();
        }
        if (editingShape) {
          ctx.save();
          ctx.beginPath();
          applyVectorShapePath(ctx, editingShape);
          // Always grape, open draft or closed-and-reopened alike: lemon on
          // cream is hard to read for the one line you're actively working
          // on, and the anchors/handles around it are grape too — a shape
          // that switched to lemon the moment it closed just read as a
          // different object.
          ctx.strokeStyle = ANCHOR_COLOR;
          ctx.lineWidth = VECTOR_LINE_WIDTH;
          ctx.stroke();
          ctx.restore();

          editingShape.anchors.forEach((a) => {
            // Handle affordances: thin connecting line + small square handle
            // ends, standard pen-tool visual — drawn under the anchor dot so
            // the anchor itself stays the primary, larger target.
            for (const handle of [a.handleIn, a.handleOut]) {
              if (!handle) continue;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(handle.x, handle.y);
              ctx.strokeStyle = ANCHOR_RING_COLOR;
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.restore();
              ctx.fillStyle = ANCHOR_COLOR;
              ctx.fillRect(handle.x - 3, handle.y - 3, 6, 6);
            }
          });
          editingShape.anchors.forEach((a) => {
            ctx.beginPath();
            ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = ANCHOR_COLOR;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
            ctx.strokeStyle = ANCHOR_RING_COLOR;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          });
        }
      }
      if (INK_TOOLS.has(drawToolRef.current) && lastPointerPosRef.current) {
        drawBrushCursor(
          ctx,
          lastPointerPosRef.current.x,
          lastPointerPosRef.current.y,
          settingsRef.current,
          strokeKindFor(drawToolRef.current)
        );
      }
      ctx.restore();
    }
    redrawRef.current = redraw;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const resizeCtx = canvas.getContext("2d");
      // scale() is multiplicative on the existing transform, not a reset — resize()
      // runs again on every native window resize AND every switch into Free Draw, so
      // without resetting first each call compounded the previous one (dpr, then dpr²,
      // dpr³, ...), pushing drawn strokes further and further from the actual pointer
      // position. setTransform back to identity first makes every call idempotent.
      resizeCtx?.setTransform(1, 0, 0, 1, 0, 0);
      resizeCtx?.scale(dpr, dpr);
      redraw();
    }
    resizeRef.current = resize;

    // Restore persisted strokes. Glyphs are already loaded via useState's lazy
    // initializer, so just prime the ref the first redraw() below will read.
    completedRef.current = loadStrokes();
    outlinesRef.current = completedRef.current.map((s) => strokeOutline(s, settingsRef.current));
    setStrokeCount(completedRef.current.length);
    vectorShapesRef.current = loadVectorShapes();
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));
    taggedIdsVectorRef.current = new Set(glyphs.flatMap((g) => g.vectorShapeIds ?? []));
    vectorFillIdsRef.current = new Set(
      glyphs.filter((g) => g.strokeIds.length === 0).flatMap((g) => g.vectorShapeIds ?? [])
    );
    gridNativeStrokeIdsRef.current = new Set(
      glyphs.filter((g) => g.cellWidth && g.cellHeight).flatMap((g) => g.strokeIds)
    );
    glyphsRef.current = glyphs;

    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): StrokePoint {
      const rect = canvas!.getBoundingClientRect();
      return [
        e.clientX - rect.left - panOffsetRef.current.x,
        e.clientY - rect.top - panOffsetRef.current.y,
        e.pressure > 0 ? e.pressure : 0.5,
      ];
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const p = pointFromEvent(e);
      notePointer(e.pointerType); // rides along on the next tool_use — see lib/analytics.ts
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      // Space held = momentary pan (Illustrator's spacebar hand), whatever
      // tool is active — same body as the Pan tool's own branch below, just
      // entered via spacePanRef so no tool switch (and none of the working
      // state a switch would clear) is involved.
      if (spacePanRef.current) {
        panDragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          offsetX: panOffsetRef.current.x,
          offsetY: panOffsetRef.current.y,
        };
        canvas!.style.cursor = "grabbing";
        return;
      }
      if (
        topModeRef.current === "draw" &&
        (e.metaKey || e.ctrlKey) &&
        CMD_SELECT_OVERRIDE_TOOLS.has(drawToolRef.current)
      ) {
        cmdSelectRef.current = true;
        drawingRef.current = true;
        strokeStartTimeRef.current = Date.now();
        lassoRef.current = [[p[0], p[1]]];
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "eraser") {
        if (eraseAt(p[0], p[1])) trackToolUse("eraser", viewLabelRef.current);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        handleNudgePointerDown(p[0], p[1]);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "anchor") {
        handleAnchorToolPointerDown(p[0], p[1]);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && VECTOR_TOOLS.has(drawToolRef.current)) {
        // Cmd/Ctrl = Illustrator's momentary direct-select, see
        // handleVectorPointerDown.
        handleVectorPointerDown(p[0], p[1], e.altKey, drawToolRef.current, e.metaKey || e.ctrlKey);
        // One sync per commit point, at the call site — the handler itself
        // returns from half a dozen branches, and every one of them is a
        // session start/switch/mutation the Path section must reflect.
        syncVectorPanelInfo();
        redraw();
        return;
      }
      // Pen, while a stroke is already being edited (entered via Anchor or
      // Nudge and kept alive across the tool switch — see the [drawTool]
      // effect): a click on one of its anchors deletes+splits, a click
      // between two anchors inserts one. Otherwise Pen falls through to its
      // normal new-freehand-stroke capture below, unchanged.
      if (topModeRef.current === "draw" && drawToolRef.current === "pen" && editingStrokeIdRef.current) {
        const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
        if (idx !== -1) {
          const stroke = completedRef.current[idx];
          const rank = anchorNear(p[0], p[1], stroke.points, anchorIndicesRef.current);
          if (rank !== null) {
            deleteAnchorAndSplit(stroke.id, rank);
            redraw();
            return;
          }
          const insertRank = findInsertionRank(p[0], p[1], stroke.points, anchorIndicesRef.current);
          if (insertRank !== null) {
            insertAnchor(stroke.id, insertRank, p[0], p[1]);
            redraw();
            return;
          }
        }
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        handleTransformPointerDown(p[0], p[1], drawToolRef.current as "move" | "rotate" | "scale", e.altKey, e.shiftKey);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        panDragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          offsetX: panOffsetRef.current.x,
          offsetY: panOffsetRef.current.y,
        };
        canvas!.style.cursor = "grabbing";
        return;
      }
      drawingRef.current = true;
      strokeStartTimeRef.current = Date.now();
      if (LASSO_TOOLS.has(drawToolRef.current)) {
        lassoRef.current = [[p[0], p[1]]];
      } else {
        currentPointsRef.current = [p];
      }
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      notePointer(e.pointerType);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      // Remembered so a bare modifier press (no pointer movement) can
      // re-derive the hover-contextual pen cursor at this same spot — see
      // refreshVectorCursor in the heldKeys/space effect below.
      lastPointerPosRef.current = { x: p[0], y: p[1] };
      // Space-pan mirrors the Pan tool's own move branch below — drag if one
      // is live, otherwise just show the hand.
      if (spacePanRef.current) {
        if (panDragStartRef.current) {
          const start = panDragStartRef.current;
          panOffsetRef.current = {
            x: start.offsetX + (e.clientX - start.clientX),
            y: start.offsetY + (e.clientY - start.clientY),
          };
          redraw();
          return;
        }
        canvas!.style.cursor = "grab";
        return;
      }
      if (cmdSelectRef.current) {
        canvas!.style.cursor = "";
        if (!drawingRef.current) return;
        lassoRef.current.push([p[0], p[1]]);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "eraser") {
        canvas!.style.cursor = "crosshair";
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null && editingStrokeIdRef.current) {
          const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
          if (idx !== -1) {
            const stroke = completedRef.current[idx];
            const pointIdx = anchorIndicesRef.current[draggingAnchorRef.current];
            const prevPressure = stroke.points[pointIdx][2];
            stroke.points[pointIdx] = [p[0], p[1], prevPressure];
            outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
            redraw();
          }
          return;
        }
        canvas!.style.cursor = editingStrokeIdRef.current ? "grab" : "pointer";
        return;
      }
      if (topModeRef.current === "draw" && VECTOR_TOOLS.has(drawToolRef.current)) {
        if (draggingHandleRef.current || draggingVectorAnchorRef.current !== null) {
          handleVectorPointerMove(p[0], p[1]);
          return;
        }
        // Idle: hover-contextual pen cursor (Illustrator parity) instead of
        // the old crosshair/pointer pair. Written only on change —
        // lastCursorRef — since the data-URI strings are ~1KB each.
        const nextCursor = vectorHoverCursor(p[0], p[1]);
        if (lastCursorRef.current !== nextCursor) {
          lastCursorRef.current = nextCursor;
          canvas!.style.cursor = nextCursor;
        }
        return;
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        if (transformStartRef.current) {
          applyTransform(p[0], p[1]);
          redraw();
          return;
        }
        canvas!.style.cursor = "move";
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        if (panDragStartRef.current) {
          const start = panDragStartRef.current;
          panOffsetRef.current = {
            x: start.offsetX + (e.clientX - start.clientX),
            y: start.offsetY + (e.clientY - start.clientY),
          };
          redraw();
          return;
        }
        canvas!.style.cursor = "grab";
        return;
      }
      if (INK_TOOLS.has(drawToolRef.current)) {
        // The OS arrow is hidden in favor of the brush-shape ring drawn in
        // redraw() below — size/angle read at a glance instead of needing
        // the sidebar sliders. Idle hover still needs its own redraw() since
        // the tail below only fires while drawingRef is true.
        canvas!.style.cursor = "none";
        if (!drawingRef.current) {
          redraw();
          return;
        }
      } else {
        canvas!.style.cursor = "";
        if (!drawingRef.current) return;
      }
      if (LASSO_TOOLS.has(drawToolRef.current)) {
        lassoRef.current.push([p[0], p[1]]);
      } else if (getHeldKeys().shift && currentPointsRef.current.length > 0) {
        const origin = currentPointsRef.current[0];
        const c = constrainTo45(origin[0], origin[1], p[0], p[1]);
        currentPointsRef.current.push([c.x, c.y, p[2]]);
      } else {
        currentPointsRef.current.push(p);
      }
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      // Space-pan release mirrors the Pan tool's own up branch below; the
      // keyup handler covers the Space-lifted-mid-drag case instead.
      if (spacePanRef.current) {
        panDragStartRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null) {
          draggingAnchorRef.current = null;
          saveStrokes(completedRef.current);
          trackToolUse("nudge", viewLabelRef.current);
        }
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && VECTOR_TOOLS.has(drawToolRef.current)) {
        const p = pointFromEvent(e);
        handleVectorPointerUp(p[0], p[1]);
        // Same call-site sync as pointerdown — pointerup is where drags
        // (handle pulls, anchor moves, corner collapses) actually commit.
        syncVectorPanelInfo();
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        const t = transformStartRef.current;
        if (t) {
          if (t.mode === "scale") {
            // Bake this gesture's magnitude into each scaled stroke's own
            // widthScale (geometric mean of the two axes — symmetric, so a
            // width-only or height-only stretch doesn't also thicken the
            // ink), so relative stroke thickness stays constant instead of
            // drifting as the shape grows/shrinks.
            const widthFactor = Math.sqrt(Math.abs(t.lastScaleX * t.lastScaleY));
            for (const id of t.snapshot.keys()) {
              const idx = completedRef.current.findIndex((s) => s.id === id);
              if (idx === -1) continue;
              const stroke = completedRef.current[idx];
              stroke.widthScale = (stroke.widthScale ?? 1) * widthFactor;
              outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
            }
          }
          transformStartRef.current = null;
          saveStrokes(completedRef.current);
          trackToolUse(t.mode, viewLabelRef.current);
        }
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        panDragStartRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (LASSO_TOOLS.has(drawToolRef.current) || cmdSelectRef.current) {
        const polygon = lassoRef.current;
        const matchedStrokes = completedRef.current
          .filter((s) => anyPointInPolygon(s.points.map((p) => [p[0], p[1]]) as [number, number][], polygon))
          .map((s) => s.id);
        // Vector shapes join the same lasso match (mainly for Assign — see
        // handleAssign, which splits selectedIds back into strokeIds vs
        // vectorShapeIds) — hit-tested by anchor point, same as strokes are
        // hit-tested by their raw points, not the filled outline.
        const matchedShapes = vectorShapesRef.current
          .filter((s) => anyPointInPolygon(s.anchors.map((a) => [a.x, a.y] as [number, number]), polygon))
          .map((s) => s.id);
        setSelectedIds([...matchedStrokes, ...matchedShapes]);
        lassoRef.current = [];
        cmdSelectRef.current = false;
      } else {
        if (drawingRef.current && currentPointsRef.current.length > 1) {
          pushUndoSnapshot();
          const stroke: Stroke = {
            id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
            points: currentPointsRef.current,
            createdAt: Date.now(),
            kind: strokeKindFor(drawToolRef.current),
          };
          completedRef.current = [...completedRef.current, stroke];
          outlinesRef.current = [...outlinesRef.current, strokeOutline(stroke, settingsRef.current)];
          saveStrokes(completedRef.current);
          setStrokeCount(completedRef.current.length);
          enqueueProvenanceEvent({
            draftId: getDraftId(),
            authorId: getAuthorId(),
            clientStrokeId: stroke.id,
            context: "free",
            tool: stroke.kind ?? "pen",
            ...summarizeStroke(stroke.points, strokeStartTimeRef.current),
          });
          trackToolUse(stroke.kind ?? "pen", viewLabelRef.current);
        }
        currentPointsRef.current = [];
      }
      drawingRef.current = false;
      canvas!.releasePointerCapture(e.pointerId);
      redraw();
    }

    // Double-click needs the same pan-corrected canvas coordinates as
    // pointFromEvent — its two constituent clicks have already run through
    // the normal pointer path by the time this fires (see
    // handleVectorDblClick for why that's fine).
    function onDblClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      handleVectorDblClick(
        e.clientX - rect.left - panOffsetRef.current.x,
        e.clientY - rect.top - panOffsetRef.current.y
      );
    }

    // Leaving the canvas mid-hover (no button down, so neither pointerup nor
    // pointercancel fires) would otherwise strand the brush-cursor ring at
    // its last position and leave the OS cursor hidden.
    function onPointerLeave() {
      lastPointerPosRef.current = null;
      canvas!.style.cursor = "";
      redraw();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  // Keep the ref in sync, and re-render every stroke already on screen whenever
  // settings change — not just strokes drawn from now on.
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    outlinesRef.current = completedRef.current.map((s) => strokeOutline(s, settings));
    redrawRef.current();
  }, [settings]);

  useEffect(() => {
    drawStyleRef.current = drawStyle;
  }, [drawStyle]);

  // Free's canvas can now mount hidden (Grid is the default view) — the
  // moment the user actually switches into it, re-measure and redraw so its
  // backing store isn't still sized for whatever it was (0x0, at first
  // mount) the last time resize() happened to run.
  useEffect(() => {
    if (topMode === "draw" && drawStyle === "free") resizeRef.current();
  }, [topMode, drawStyle]);

  // Keep Free mode's line raster in sync whenever its spacing changes.
  useEffect(() => {
    lineSpacingRef.current = lineSpacing;
    redrawRef.current();
  }, [lineSpacing]);

  useEffect(() => {
    topModeRef.current = topMode;
    currentPointsRef.current = [];
    lassoRef.current = [];
    setSelectedIds([]);
    exitNudgeEditing();
    exitVectorEditing();
    redrawRef.current();
  }, [topMode]);

  useEffect(() => {
    drawToolRef.current = drawTool;
    // Nudge, Anchor, and Pen all share one "which stroke is being edited"
    // session (Pen needs it live so its insert/delete-anchor clicks — see
    // handleAnchorInsertOrDelete — have something to operate on); switching
    // to anything else exits it.
    if (drawTool !== "nudge" && drawTool !== "anchor" && drawTool !== "pen") exitNudgeEditing();
    // Same shared-session idea for the Vector family (see VECTOR_TOOLS): the
    // pen and the three anchor tools hand the same shape back and forth, so
    // only leaving the family entirely ends the session.
    if (!VECTOR_TOOLS.has(drawTool)) exitVectorEditing();
    if (drawTool !== "move" && drawTool !== "rotate" && drawTool !== "scale") transformStartRef.current = null;
    if (drawTool !== "pan") panDragStartRef.current = null;
    // Switching tools mid-gesture shouldn't leave a stale in-progress pen
    // stroke or lasso outline drawn on screen for a tool that's no longer
    // active. Selection is shared working state across SELECTION_TOOLS
    // (Assign/Select/Move/Rotate/Scale), so it's spared while switching
    // among those — only switching to a non-selection tool clears it.
    currentPointsRef.current = [];
    lassoRef.current = [];
    if (!SELECTION_TOOLS.has(drawTool)) setSelectedIds([]);
    // Other tools write style.cursor directly, so the vector hover cache
    // (write-on-change only) would otherwise believe its last value is still
    // on screen and skip restoring it.
    lastCursorRef.current = "";
    // The ONE writer of activeByGroup: whenever the newly active tool
    // belongs to a toolbar group, its slot button starts wearing that
    // tool's face (Illustrator's flyout memory) — routing this through the
    // [drawTool] chokepoint means keyboard, menu bar, flyout clicks, and
    // programmatic switches all update the slot identically.
    const toolGroup = TOOL_DEFS.find((t) => t.value === drawTool)?.group;
    if (toolGroup) {
      setActiveByGroup((prev) => (prev[toolGroup] === drawTool ? prev : { ...prev, [toolGroup]: drawTool }));
    }
    redrawRef.current();
  }, [drawTool]);

  useEffect(() => {
    exitNudgeEditing();
    exitVectorEditing();
    panOffsetRef.current = { x: 0, y: 0 };
    // Leaving Free strands drawTool on a value ("nudge"/"assign"/"select"/
    // "move"/"rotate"/"scale"/"pan") whose button no longer exists in the
    // UI — reset it back to the universal default so Grid/Editor don't
    // silently inherit a stale tool (see GridCell's tool coercion, which
    // would otherwise just treat it as pen with no visual indication
    // anything was off).
    setDrawTool((t) => (FREE_ONLY_TOOLS.has(t) ? "pen" : t));
    redrawRef.current();
  }, [drawStyle]);

  // Leaving the Nudge tool (or switching away from Draw/Free entirely, see
  // above) clears which stroke was being reshaped — a stale editing session
  // shouldn't reappear later just because the tool got reselected.
  function exitNudgeEditing() {
    editingStrokeIdRef.current = null;
    anchorIndicesRef.current = [];
    resampledRef.current = false;
    draggingAnchorRef.current = null;
    selectedAnchorRef.current = null;
  }

  // Same idea as exitNudgeEditing, for the Vector tool's editing session. An
  // in-progress OPEN path that never got closed is left as-is (not
  // discarded) — switching tools mid-draw shouldn't silently lose points;
  // reselecting Vector and clicking it again resumes editing it.
  function exitVectorEditing() {
    editingShapeIdRef.current = null;
    draggingVectorAnchorRef.current = null;
    draggingHandleRef.current = null;
    placingNewAnchorRef.current = false;
    vectorDragStartRef.current = null;
    lastClickedAnchorIndexRef.current = null;
    // No session — the palette's Path section (Glyphs' Info box) empties too.
    setVectorPanelInfo(null);
  }

  useEffect(() => {
    selectedIdsRef.current = new Set(selectedIds);
    if (selectedIds.length === 0) {
      skewSnapshotRef.current = null;
    } else {
      const selected = completedRef.current.filter((s) => selectedIds.includes(s.id));
      const pivot = selectionPivot(selected);
      skewSnapshotRef.current = {
        pivotX: pivot.x,
        pivotY: pivot.y,
        snapshot: new Map(selected.map((s) => [s.id, s.points.map((p) => [...p] as StrokePoint)])),
      };
    }
    setSkewH(0);
    setSkewV(0);
    skewUndoPushedRef.current = false;
    redrawRef.current();
  }, [selectedIds]);

  // Mini analytics (see /anneliese): pageview on mount + visible-time
  // duration beacons, all of it in lib/visitDuration.ts so the marketplace
  // pages measure by the exact same rules. The pageview stays the coarse
  // "editor" surface (the marketplace browse→download ratio counts those
  // values); duration rows carry the finer view below, so switching between
  // Free/Grid/Editor/Animate splits the visit into per-view segments.
  useVisitTracking("editor", viewLabelRef.current);

  // Provenance queue: periodic flush so a long drawing session doesn't sit
  // on an ever-growing localStorage-backed queue, plus a pagehide flush so
  // closing the tab mid-session doesn't lose the tail of it (same pattern
  // as the analytics beacon above). enqueueProvenanceEvent already flushes
  // once the queue hits its own batch size — this just covers the "drew a
  // few strokes, then went idle" gap.
  useEffect(() => {
    const interval = setInterval(flushProvenanceQueue, 15000);
    window.addEventListener("pagehide", flushProvenanceQueue);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", flushProvenanceQueue);
      flushProvenanceQueue();
    };
  }, []);

  useEffect(() => {
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));
    taggedIdsVectorRef.current = new Set(glyphs.flatMap((g) => g.vectorShapeIds ?? []));
    vectorFillIdsRef.current = new Set(
      glyphs.filter((g) => g.strokeIds.length === 0).flatMap((g) => g.vectorShapeIds ?? [])
    );
    gridNativeStrokeIdsRef.current = new Set(
      glyphs.filter((g) => g.cellWidth && g.cellHeight).flatMap((g) => g.strokeIds)
    );
    glyphsRef.current = glyphs;
    saveGlyphs(glyphs);
    redrawRef.current();
  }, [glyphs]);

  // Recompiled on every relevant change (not gated on any particular view
  // being open) — File > Export JSON/OTF read exportJson/exportDoc directly,
  // so they need to stay current regardless of which view the user is on.
  useEffect(() => {
    const doc = compileDocument(glyphs, completedRef.current, vectorShapesRef.current, settings, metrics);
    setExportJson(JSON.stringify(doc, null, 2));
    setExportDoc(doc);
  }, [glyphs, settings, metrics]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (topModeRef.current !== "draw") return;
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }

      // Copy/Paste (Free only — Grid has its own copy of this in
      // GridCell.tsx, sharing the same src/lib/clipboard.ts singleton so
      // content can cross between Free and any Grid cell). Guarded against
      // typing in a text field up front, unlike Undo/Redo above — Cmd+C in a
      // glyph-name field should copy the selected text, not the canvas.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        if (topModeRef.current !== "draw" || drawStyleRef.current !== "free" || selectedIdsRef.current.size === 0) return;
        e.preventDefault();
        const strokes: ClipboardStroke[] = completedRef.current
          .filter((s) => selectedIdsRef.current.has(s.id))
          .map((s) => ({
            points: s.points.map((p) => [...p] as StrokePoint),
            kind: s.kind,
            widthScale: s.widthScale,
            source: "free" as const,
          }));
        const shapes: ClipboardShape[] = vectorShapesRef.current
          .filter((s) => selectedIdsRef.current.has(s.id))
          .map((s) => ({
            closed: s.closed,
            anchors: s.anchors.map((a) => ({
              x: a.x,
              y: a.y,
              handleIn: a.handleIn ? { ...a.handleIn } : undefined,
              handleOut: a.handleOut ? { ...a.handleOut } : undefined,
              smooth: a.smooth,
            })),
          }));
        setClipboard({ strokes, shapes });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        if (topModeRef.current !== "draw" || drawStyleRef.current !== "free") return;
        const clip = getClipboard();
        if (!clip || (clip.strokes.length === 0 && clip.shapes.length === 0)) return;
        e.preventDefault();
        pushUndoSnapshot();
        // A fixed nudge, not a rescale — Free is a single absolute canvas, so
        // content pasted from either Free or a Grid cell lands exactly where
        // it was, just offset enough to be visibly distinct from the source.
        const OFFSET = 24;
        const newStrokes: Stroke[] = clip.strokes.map((cs) => ({
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          points: cs.points.map(([x, y, p]) => [x + OFFSET, y + OFFSET, p] as StrokePoint),
          createdAt: Date.now(),
          kind: cs.kind,
          widthScale: cs.widthScale,
        }));
        completedRef.current = [...completedRef.current, ...newStrokes];
        outlinesRef.current = [
          ...outlinesRef.current,
          ...newStrokes.map((s) => strokeOutline(s, settingsRef.current)),
        ];
        saveStrokes(completedRef.current);
        setStrokeCount(completedRef.current.length);

        const newShapes: VectorShape[] = clip.shapes.map((cs) => ({
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          closed: cs.closed,
          createdAt: Date.now(),
          anchors: cs.anchors.map((a) => ({
            x: a.x + OFFSET,
            y: a.y + OFFSET,
            handleIn: a.handleIn ? { x: a.handleIn.x + OFFSET, y: a.handleIn.y + OFFSET } : undefined,
            handleOut: a.handleOut ? { x: a.handleOut.x + OFFSET, y: a.handleOut.y + OFFSET } : undefined,
            smooth: a.smooth,
          })),
        }));
        vectorShapesRef.current = [...vectorShapesRef.current, ...newShapes];
        saveVectorShapes(vectorShapesRef.current);

        setSelectedIds([...newStrokes.map((s) => s.id), ...newShapes.map((s) => s.id)]);
        trackToolUse("paste", viewLabelRef.current);
        redrawRef.current();
        return;
      }

      // Per-tool shortcuts (see TOOL_DEFS) — only in Draw, and never while
      // the user is actually typing a glyph name/text (those single-letter
      // inputs can legitimately contain any of these letters).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (topModeRef.current !== "draw") return;
      const key = e.key.toLowerCase();
      const toolDef = TOOL_DEFS.find((t) => t.shortcut === key || t.altShortcut === key);
      if (toolDef && (!FREE_ONLY_TOOLS.has(toolDef.value) || drawStyleRef.current === "free")) {
        setDrawTool(toolDef.value);
      }
      else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        drawToolRef.current === "anchor" &&
        selectedAnchorRef.current
      ) {
        e.preventDefault();
        deleteAnchorAndSplit(selectedAnchorRef.current.strokeId, selectedAnchorRef.current.rank);
      }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        deleteStrokes(new Set(selectedIdsRef.current));
        setSelectedIds([]);
      }
      // Esc/Enter = Illustrator's end-the-path: the shape stays exactly as
      // drawn (an open path stays open, resumable by clicking it later — see
      // exitVectorEditing), only the editing session ends so the next click
      // starts a fresh path instead of extending this one. Yields to the
      // Info/How-to modal's own Escape closer while that is open.
      else if (
        (e.key === "Escape" || e.key === "Enter") &&
        VECTOR_TOOLS.has(drawToolRef.current) &&
        editingShapeIdRef.current &&
        !infoModalRef.current
      ) {
        e.preventDefault();
        exitVectorEditing();
        redrawRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Held-modifier singleton (heldKeys.ts — shared with every GridCell) plus
  // the two behaviors that hang off bare key presses rather than pointer
  // events: Space = momentary pan, and Alt/Meta/Ctrl refreshing the
  // hover-contextual pen cursor in place. initHeldKeys() runs first so its
  // own listeners are registered before these — getHeldKeys() is already
  // current by the time refreshVectorCursor reads it.
  useEffect(() => {
    initHeldKeys();

    // Re-derive the pen cursor at the LAST hover position when a modifier
    // changes with the mouse still — Illustrator flips the cursor the moment
    // Cmd or Alt goes down, not on the next accidental jiggle.
    function refreshVectorCursor() {
      const canvas = canvasRef.current;
      const pos = lastPointerPosRef.current;
      if (!canvas || !pos) return;
      if (topModeRef.current !== "draw" || drawStyleRef.current !== "free") return;
      if (!VECTOR_TOOLS.has(drawToolRef.current)) return;
      // Mid-drag and space-pan cursors are owned by the pointer handlers.
      if (draggingHandleRef.current || draggingVectorAnchorRef.current !== null) return;
      if (spacePanRef.current) return;
      const next = vectorHoverCursor(pos.x, pos.y);
      if (lastCursorRef.current !== next) {
        lastCursorRef.current = next;
        canvas.style.cursor = next;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Alt" || e.key === "Meta" || e.key === "Control") refreshVectorCursor();
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (topModeRef.current !== "draw" || drawStyleRef.current !== "free") return;
      // preventDefault on repeats too — held Space must never scroll the
      // page mid-pan — but the ref/cursor writes only need doing once.
      e.preventDefault();
      if (e.repeat) return;
      spacePanRef.current = true;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "grab";
      lastCursorRef.current = "";
    }

    // Shared by keyup and window blur — Cmd+Tabbing away mid-pan would
    // otherwise never deliver the Space keyup and leave the hand stuck on.
    function endSpacePan() {
      if (!spacePanRef.current) return;
      spacePanRef.current = false;
      // A drag still live when Space lifts commits where it is —
      // panOffsetRef is already current, only the gesture bookkeeping and
      // cursor need clearing.
      panDragStartRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "";
      lastCursorRef.current = "";
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Alt" || e.key === "Meta" || e.key === "Control") refreshVectorCursor();
      if (e.code === "Space") endSpacePan();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", endSpacePan);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", endSpacePan);
    };
  }, []);

  // Dismiss an open menu-bar dropdown on any click outside the menu bar
  // (tagged data-chrome-menu) — NOT a ref around the whole page, since that
  // would make every click (including ones on the canvas) count as "inside".
  useEffect(() => {
    if (!openMenu) return;
    function onPointerDownOutside(e: PointerEvent) {
      if (!(e.target as HTMLElement).closest?.("[data-chrome-menu]")) {
        setOpenMenu(null);
      }
    }
    window.addEventListener("pointerdown", onPointerDownOutside);
    return () => window.removeEventListener("pointerdown", onPointerDownOutside);
  }, [openMenu]);

  // Escape closes the Info/How-to modal — the backdrop click already
  // handles pointer dismissal, this covers keyboard users.
  useEffect(() => {
    if (!infoModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setInfoModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoModal]);

  const UNDO_HISTORY_LIMIT = 50;

  function cloneStrokesForHistory(strokes: Stroke[]): Stroke[] {
    return strokes.map((s) => ({ ...s, points: s.points.map((p) => [...p] as StrokePoint) }));
  }

  function snapshotNow(): { strokes: Stroke[]; glyphs: Glyph[] } {
    return { strokes: cloneStrokesForHistory(completedRef.current), glyphs: glyphsRef.current.map((g) => ({ ...g })) };
  }

  // Call this right before ANY mutation to completedRef/glyphs that should
  // be undoable — a new stroke, a deletion, a Nudge/Move/Rotate/Scale
  // commit. Captures the state as it was the instant before, so handleUndo
  // just needs to jump back to whatever's on top of this stack.
  function pushUndoSnapshot() {
    undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_HISTORY_LIMIT - 1)), snapshotNow()];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }

  function applySnapshot(snap: { strokes: Stroke[]; glyphs: Glyph[] }) {
    completedRef.current = snap.strokes;
    outlinesRef.current = snap.strokes.map((s) => strokeOutline(s, settingsRef.current));
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    setGlyphs(snap.glyphs);
    // Any in-progress Nudge/transform session was editing state that no
    // longer exists after the jump — drop it rather than let it silently
    // keep mutating a stroke id from a different point in history.
    exitNudgeEditing();
    transformStartRef.current = null;
    setSelectedIds([]);
    redrawRef.current();
  }

  function handleUndo() {
    if (undoStackRef.current.length === 0) return;
    trackUndo(); // tagged with the last tool that reported a use — see lib/analytics.ts
    const current = snapshotNow();
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, current];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(prev);
  }
  undoRef.current = handleUndo;

  function handleRedo() {
    if (redoStackRef.current.length === 0) return;
    const current = snapshotNow();
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, current];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(next);
  }
  redoRef.current = handleRedo;

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (completedRef.current.length > 0 || glyphsRef.current.length > 0) pushUndoSnapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    clearStrokes();
    vectorShapesRef.current = [];
    clearVectorShapes();
    exitVectorEditing();
    setStrokeCount(0);
    setGlyphs([]);
    setSelectedIds([]);
  }

  function updateSetting<K extends keyof StrokeSettings>(key: K, value: StrokeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  // Switching brush keeps BOTH parameter sets (see BrushSettings) — a tuned
  // nib survives a detour through the scatter brush and back.
  function updateBrushKind(kind: BrushKind) {
    setSettings((s) => ({ ...s, brush: { ...s.brush, kind } }));
  }

  function updateNib<K extends keyof NibParams>(key: K, value: NibParams[K]) {
    setSettings((s) => ({ ...s, brush: { ...s.brush, nib: { ...s.brush.nib, [key]: value } } }));
  }

  function updateScatter<K extends keyof ScatterParams>(key: K, value: ScatterParams[K]) {
    setSettings((s) => ({ ...s, brush: { ...s.brush, scatter: { ...s.brush.scatter, [key]: value } } }));
  }

  function resetBrushParams() {
    setSettings((s) => ({
      ...s,
      brush: s.brush.kind === "nib" ? { ...s.brush, nib: DEFAULT_NIB } : { ...s.brush, scatter: DEFAULT_SCATTER },
    }));
  }

  // Shears the selection around its bbox center, always recomputed from the
  // ONE pre-skew snapshot captured when the selection was made (see the
  // [selectedIds] effect above) — a proper combined shear matrix using each
  // point's ORIGINAL offset from the pivot for both axes, so horizontal and
  // vertical skew combine cleanly regardless of slider order, and repeated
  // small ticks never compound/drift.
  function applySkew(hDeg: number, vDeg: number) {
    const snap = skewSnapshotRef.current;
    if (!snap) return;
    const kH = Math.tan((hDeg * Math.PI) / 180);
    const kV = Math.tan((vDeg * Math.PI) / 180);
    for (const [id, points] of snap.snapshot) {
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      const stroke = completedRef.current[idx];
      stroke.points = points.map(([px, py, pressure]) => {
        const dx = px - snap.pivotX;
        const dy = py - snap.pivotY;
        return [snap.pivotX + dx + kH * dy, snap.pivotY + dy + kV * dx, pressure] as StrokePoint;
      });
      outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
    }
    saveStrokes(completedRef.current);
    redrawRef.current();
  }

  function updateSkewH(hDeg: number) {
    if (!skewUndoPushedRef.current) {
      pushUndoSnapshot();
      skewUndoPushedRef.current = true;
    }
    setSkewH(hDeg);
    applySkew(hDeg, skewV);
  }

  function updateSkewV(vDeg: number) {
    if (!skewUndoPushedRef.current) {
      pushUndoSnapshot();
      skewUndoPushedRef.current = true;
    }
    setSkewV(vDeg);
    applySkew(skewH, vDeg);
  }

  function handleAssign() {
    const alternateOf = alternateOfInput.trim();
    if (kindInput === "alternate" && !alternateOf) return;
    const name = kindInput === "alternate" ? nextAlternateName(alternateOf, glyphs) : nameInput.trim();
    if (!name || selectedIds.length === 0) return;
    const vectorIdSet = new Set(vectorShapesRef.current.map((s) => s.id));
    const strokeIds = selectedIds.filter((id) => !vectorIdSet.has(id));
    const vectorShapeIds = selectedIds.filter((id) => vectorIdSet.has(id));
    const glyph: Glyph = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name,
      kind: kindInput,
      strokeIds,
      ...(vectorShapeIds.length > 0 ? { vectorShapeIds } : {}),
      createdAt: Date.now(),
      ...(kindInput === "base" ? { unicode: unicodeFor(name) } : {}),
      ...(kindInput === "ligature"
        ? { components: componentsInput.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean) }
        : {}),
      ...(kindInput === "alternate" ? { alternateOf } : {}),
    };
    setGlyphs((gs) => [...gs, glyph]);
    setSelectedIds([]);
    setNameInput("");
    setComponentsInput("");
    setAlternateOfInput("");
    trackToolUse("assign", viewLabelRef.current);
  }

  function handleAssignKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleAssign();
    }
  }

  // Grid's own version of handleAssign — instead of tagging an existing
  // lasso selection, this just adds an empty cell to draw into (Grid fuses
  // capture+tagging on first stroke, so there's nothing to select yet).
  // Shares nameInput/kindInput/componentsInput/alternateOfInput with Free's
  // Assign panel since the two forms are never visible at the same time.
  function handleAddGridSlot() {
    const alternateOf = alternateOfInput.trim();
    if (kindInput === "alternate" && !alternateOf) return;
    // Pending (undrawn) alt slots take up a name slot too, so count them
    // alongside committed glyphs — otherwise two alts added back-to-back in
    // Grid before either is drawn would both land on the same `.alt1` name.
    const name = kindInput === "alternate" ? nextAlternateName(alternateOf, [...glyphs, ...extraGridSlots]) : nameInput.trim();
    if (!name) return;
    addGridSlot({
      name,
      kind: kindInput,
      ...(kindInput === "ligature"
        ? { components: componentsInput.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean) }
        : {}),
      ...(kindInput === "alternate" ? { alternateOf } : {}),
    });
    setNameInput("");
    setComponentsInput("");
    setAlternateOfInput("");
  }

  function handleUntag(id: string) {
    setGlyphs((gs) => gs.filter((g) => g.id !== id));
  }

  // Shared by the Eraser tool's single-stroke click-to-delete, the
  // Delete/Backspace shortcut's whole-selection removal, and GridCell's own
  // eraser/Delete-key handling: either way it's "remove these ids from
  // completedRef/outlinesRef and untie them from any glyph." One call here
  // is always exactly one undo step, however many ids it covers — that's
  // why GridCell's Delete-key handler passes its whole selection in one
  // Set rather than looping single-id calls.
  function deleteStrokes(idsToDelete: Set<string>) {
    if (idsToDelete.size === 0) return;
    pushUndoSnapshot();
    const survivors = completedRef.current
      .map((stroke, i) => ({ stroke, outline: outlinesRef.current[i] }))
      .filter(({ stroke }) => !idsToDelete.has(stroke.id));
    completedRef.current = survivors.map((s) => s.stroke);
    outlinesRef.current = survivors.map((s) => s.outline);
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    // Strokes that got deleted no longer belong to any glyph; a glyph left
    // with zero strokes doesn't mean anything, so drop it too.
    setGlyphs((gs) =>
      gs
        .map((g) => ({ ...g, strokeIds: g.strokeIds.filter((id) => !idsToDelete.has(id)) }))
        .filter((g) => g.strokeIds.length > 0)
    );
    setSelectedIds((ids) => ids.filter((id) => !idsToDelete.has(id)));
  }

  // Eraser tool: click a completed stroke in Draw mode to delete it
  // immediately, no lasso/select step needed. Topmost (last-drawn) stroke
  // wins when strokes overlap — same convention as GridCell's select mode.
  function eraseAt(x: number, y: number): boolean {
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      if (pointInPolygon([x, y], outlinesRef.current[i].envelope)) {
        deleteStrokes(new Set([completedRef.current[i].id]));
        return true;
      }
    }
    return false;
  }

  // Is (x, y) within grabbing distance of one of the currently-editing
  // stroke's anchor handles? Returns the anchor's rank (its position within
  // `indices`, not the raw point index) so the caller has a stable handle
  // that survives the lazy resample below (resampling preserves order, so
  // rank i always means "the same anchor" before and after).
  function anchorNear(x: number, y: number, points: StrokePoint[], indices: number[]): number | null {
    for (let rank = indices.length - 1; rank >= 0; rank--) {
      const [px, py] = points[indices[rank]];
      if (Math.hypot(x - px, y - py) <= ANCHOR_HIT_PX) return rank;
    }
    return null;
  }

  // Nudge tool click: if already editing a stroke, first check for an
  // anchor grab (and start dragging it — lazily resampling the stroke down
  // to just its anchors on the very first drag of this session, see the
  // comment inline). Otherwise, clicking any stroke (including the one
  // already being edited) starts/switches the editing session onto it;
  // clicking empty space exits editing. Topmost (last-drawn) stroke wins,
  // same convention as the Eraser tool and GridCell's select mode.
  function handleNudgePointerDown(x: number, y: number) {
    if (editingStrokeIdRef.current) {
      const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
      if (idx !== -1) {
        const stroke = completedRef.current[idx];
        const rank = anchorNear(x, y, stroke.points, anchorIndicesRef.current);
        if (rank !== null) {
          // An actual anchor grab is a real, undoable mutation — captured
          // once here, before the (possibly first-ever) resample, so Undo
          // restores the original dense points, not the resampled shape.
          pushUndoSnapshot();
          if (!resampledRef.current) {
            // Non-destructive up to this exact moment: a stroke the user
            // merely selects (or drags near but never actually grabs) stays
            // byte-for-byte untouched. Only an actual anchor grab collapses
            // the dense raw samples down to just the retained anchors, so
            // moving one afterward reshapes the segment the way a real
            // vector-tool edit would, instead of nudging one sample among
            // dozens that immediately pull the curve back.
            stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
            anchorIndicesRef.current = stroke.points.map((_, i) => i);
            resampledRef.current = true;
            outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
          }
          draggingAnchorRef.current = rank;
          return;
        }
      }
    }

    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      const stroke = completedRef.current[i];
      // A brush stroke's points trace its own edge, not a true centerline —
      // editing them as if they were one wouldn't reshape the visible ink
      // sensibly. Skip silently, same as clicking empty space would.
      if ((stroke.kind ?? "pen") === "brush") continue;
      if (pointInPolygon([x, y], outlinesRef.current[i].envelope)) {
        editingStrokeIdRef.current = stroke.id;
        anchorIndicesRef.current = simplifyStrokeIndices(stroke.points.map((p) => [p[0], p[1]]));
        resampledRef.current = false;
        return;
      }
    }
    exitNudgeEditing();
  }

  // Anchor tool click: if a stroke is already being edited (editingStrokeIdRef
  // set — via a prior click here, or via Nudge, since the two tools share one
  // editing session, see the [drawTool] effect above), clicking one of its
  // anchors SELECTS it — persisted in selectedAnchorRef, unlike Nudge's
  // drag-only grab — rather than starting a drag. Clicking the stroke
  // elsewhere (no anchor hit) keeps editing it but deselects any anchor.
  // Clicking a different stroke switches the editing session onto it,
  // exactly Nudge's own fallback; clicking empty space exits. Topmost
  // stroke wins, same convention as Nudge/Eraser.
  function handleAnchorToolPointerDown(x: number, y: number) {
    if (editingStrokeIdRef.current) {
      const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
      if (idx !== -1) {
        const stroke = completedRef.current[idx];
        const rank = anchorNear(x, y, stroke.points, anchorIndicesRef.current);
        if (rank !== null) {
          selectedAnchorRef.current = { strokeId: stroke.id, rank };
          return;
        }
      }
    }
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      const stroke = completedRef.current[i];
      if ((stroke.kind ?? "pen") === "brush") continue;
      if (pointInPolygon([x, y], outlinesRef.current[i].envelope)) {
        editingStrokeIdRef.current = stroke.id;
        anchorIndicesRef.current = simplifyStrokeIndices(stroke.points.map((p) => [p[0], p[1]]));
        resampledRef.current = false;
        selectedAnchorRef.current = null;
        return;
      }
    }
    exitNudgeEditing();
  }

  // Pen-tool insert-between-anchors hit test: projects (x, y) onto each
  // segment between consecutive anchors, clamped to the segment itself (not
  // simplify.ts's perpendicularDistance, which projects onto the INFINITE
  // line for a different purpose — simplification, not hit-testing a finite
  // segment). Returns the LEFT rank of the segment the click falls near
  // ("insert between rank and rank+1"), not a raw point index — see
  // insertAnchor for why rank is what survives the lazy resample below.
  function findInsertionRank(x: number, y: number, points: StrokePoint[], indices: number[]): number | null {
    for (let rank = 0; rank < indices.length - 1; rank++) {
      const [x1, y1] = points[indices[rank]];
      const [x2, y2] = points[indices[rank + 1]];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      if (t < 0 || t > 1) continue;
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      if (Math.hypot(x - projX, y - projY) <= ANCHOR_HIT_PX) return rank;
    }
    return null;
  }

  // Inserts a new anchor right after `afterRank`. Forces the same lazy
  // resample-to-anchors-only collapse Nudge's first drag does (if it hasn't
  // already happened this editing session) BEFORE converting the rank to a
  // raw point index — after that resample, anchorIndicesRef is always the
  // identity 0..n-1 over stroke.points, so rank and raw index coincide.
  // Doing it in this order (rank in, resample, then rank->index) is what
  // keeps this correct whether or not a resample was already pending;
  // resolving to a raw index first and resampling after would silently
  // insert at the wrong position once the array shrinks out from under it.
  function insertAnchor(strokeId: string, afterRank: number, x: number, y: number) {
    const idx = completedRef.current.findIndex((s) => s.id === strokeId);
    if (idx === -1) return;
    pushUndoSnapshot();
    const stroke = completedRef.current[idx];
    if (!resampledRef.current) {
      stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
      anchorIndicesRef.current = stroke.points.map((_, i) => i);
      resampledRef.current = true;
    }
    const pointIndex = afterRank + 1;
    const before = stroke.points[pointIndex - 1];
    const after = stroke.points[pointIndex];
    const pressure = before && after ? (before[2] + after[2]) / 2 : (before ?? after)?.[2] ?? 0.5;
    stroke.points = [
      ...stroke.points.slice(0, pointIndex),
      [x, y, pressure] as StrokePoint,
      ...stroke.points.slice(pointIndex),
    ];
    anchorIndicesRef.current = anchorIndicesRef.current
      .map((i) => (i >= pointIndex ? i + 1 : i))
      .concat(pointIndex)
      .sort((a, b) => a - b);
    outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
    saveStrokes(completedRef.current);
    redrawRef.current();
  }

  // Deletes the anchor at `rank` and splits the stroke into two at that
  // position (the deleted point itself is dropped, not bridged). Same
  // resample-first-if-needed + rank->index conversion as insertAnchor.
  // Deleting an endpoint (rank 0 or the last) just shrinks the stroke by one
  // point instead of splitting — one side would be empty anyway. A stroke
  // collapsing below 2 points afterward is dropped entirely, matching how
  // deleteStrokes already treats a glyph left with 0 strokes. This is a
  // structural edit (changes stroke/glyph count), a strictly more
  // destructive class than anchor-dragging or insertion — hence its own
  // pushUndoSnapshot rather than piggybacking on one of those.
  function deleteAnchorAndSplit(strokeId: string, rank: number) {
    const idx = completedRef.current.findIndex((s) => s.id === strokeId);
    if (idx === -1) return;
    pushUndoSnapshot();
    const stroke = completedRef.current[idx];
    if (!resampledRef.current) {
      stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
      anchorIndicesRef.current = stroke.points.map((_, i) => i);
      resampledRef.current = true;
    }
    const pointIndex = rank;
    const before = stroke.points.slice(0, pointIndex);
    const after = stroke.points.slice(pointIndex + 1);

    const newStrokes: Stroke[] = [];
    if (pointIndex === 0 || pointIndex === stroke.points.length - 1) {
      const shrunk = pointIndex === 0 ? after : before;
      if (shrunk.length >= 2) newStrokes.push({ ...stroke, points: shrunk });
    } else {
      if (before.length >= 2) {
        newStrokes.push({ id: `${Date.now()}-${Math.round(Math.random() * 1e6)}-a`, points: before, createdAt: stroke.createdAt });
      }
      if (after.length >= 2) {
        newStrokes.push({ id: `${Date.now()}-${Math.round(Math.random() * 1e6)}-b`, points: after, createdAt: stroke.createdAt });
      }
    }

    completedRef.current = completedRef.current.flatMap((s, i) => (i === idx ? newStrokes : [s]));
    outlinesRef.current = completedRef.current.map((s) => strokeOutline(s, settingsRef.current));
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);

    // Mirrors deleteStrokes's own glyph-bookkeeping pattern: the one deleted
    // stroke id is replaced by however many new ids it split into (0, 1, or
    // 2), and a glyph left with no strokes is dropped.
    setGlyphs((gs) =>
      gs
        .map((g) =>
          g.strokeIds.includes(strokeId)
            ? { ...g, strokeIds: g.strokeIds.flatMap((id) => (id === strokeId ? newStrokes.map((s) => s.id) : [id])) }
            : g
        )
        .filter((g) => g.strokeIds.length > 0)
    );

    exitNudgeEditing();
  }

  // --- Vector tool (true Bezier shapes, src/lib/vectorShapes.ts) ---
  // Unlike the Stroke-anchor tools above, VectorShape anchors ARE the stored
  // data — no simplify/resample indirection, so these hit-tests work
  // directly against shape.anchors and return real indices, not ranks.

  function vectorAnchorNear(shape: VectorShape, x: number, y: number): number | null {
    for (let i = shape.anchors.length - 1; i >= 0; i--) {
      const a = shape.anchors[i];
      if (Math.hypot(x - a.x, y - a.y) <= ANCHOR_HIT_PX) return i;
    }
    return null;
  }

  function vectorHandleNear(
    shape: VectorShape,
    x: number,
    y: number
  ): { anchorIndex: number; which: "handleIn" | "handleOut" } | null {
    for (let i = shape.anchors.length - 1; i >= 0; i--) {
      const a = shape.anchors[i];
      if (a.handleOut && Math.hypot(x - a.handleOut.x, y - a.handleOut.y) <= ANCHOR_HIT_PX) {
        return { anchorIndex: i, which: "handleOut" };
      }
      if (a.handleIn && Math.hypot(x - a.handleIn.x, y - a.handleIn.y) <= ANCHOR_HIT_PX) {
        return { anchorIndex: i, which: "handleIn" };
      }
    }
    return null;
  }

  // Same idea as findInsertionRank for strokes, but hit-tests the true
  // sampled curve (cubicPoint, same math flattenVectorShape uses at compile
  // time) rather than a straight line between anchors — a click near a
  // pronounced curve's midpoint should register even though it's far from
  // the anchor-to-anchor chord. Reports WHERE on the segment the click landed
  // (index = the segment's left anchor, t = the Bezier parameter), because
  // splitVectorSegment needs a parameter to split at, not just a segment. Also
  // takes the CLOSEST point across the whole shape rather than the first one
  // within tolerance, so a click where two segments run close together inserts
  // on the one actually aimed at.
  function vectorSegmentHit(shape: VectorShape, x: number, y: number): { index: number; t: number } | null {
    const segmentCount = shape.closed ? shape.anchors.length : shape.anchors.length - 1;
    let best: { index: number; t: number; dist: number } | null = null;
    for (let i = 0; i < segmentCount; i++) {
      const p0 = shape.anchors[i];
      const p1 = shape.anchors[(i + 1) % shape.anchors.length];
      const c1 = p0.handleOut ?? p0;
      const c2 = p1.handleIn ?? p1;
      let prev: [number, number] = [p0.x, p0.y];
      for (let s = 1; s <= 24; s++) {
        const pt = cubicPoint(p0, c1, c2, p1, s / 24);
        const dx = pt[0] - prev[0];
        const dy = pt[1] - prev[1];
        const lenSq = dx * dx + dy * dy;
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - prev[0]) * dx + (y - prev[1]) * dy) / lenSq));
        const projX = prev[0] + t * dx;
        const projY = prev[1] + t * dy;
        const dist = Math.hypot(x - projX, y - projY);
        // The projection sits somewhere inside sample step s, so its curve
        // parameter interpolates across that step.
        if (dist <= ANCHOR_HIT_PX && (!best || dist < best.dist)) {
          best = { index: i, t: (s - 1 + t) / 24, dist };
        }
        prev = pt;
      }
    }
    return best ? { index: best.index, t: best.t } : null;
  }

  // Adds an anchor that sits exactly ON the curve and leaves its shape
  // untouched (De Casteljau split — see splitVectorSegment in contour.ts).
  // Both routes into inserting a point use it: the Add Anchor tool and the
  // Pen's own click-on-a-segment. This replaces the older insertVectorAnchor,
  // which dropped a plain corner at the clicked position and visibly deformed
  // the curve it was inserted into.
  function insertVectorAnchorOnCurve(shapeId: string, segmentIndex: number, t: number) {
    const idx = vectorShapesRef.current.findIndex((s) => s.id === shapeId);
    if (idx === -1) return;
    const shape = vectorShapesRef.current[idx];
    shape.anchors = splitVectorSegment(shape, segmentIndex, t);
    saveVectorShapes(vectorShapesRef.current);
  }

  // Deletes the anchor at `index`. A shape left with fewer than 2 anchors
  // can't be a shape anymore — dropped entirely, same convention as
  // deleteAnchorAndSplit dropping sub-2-point strokes, including glyph
  // bookkeeping (a glyph left referencing nothing is dropped too).
  function deleteVectorAnchorAt(shapeId: string, index: number) {
    const idx = vectorShapesRef.current.findIndex((s) => s.id === shapeId);
    if (idx === -1) return;
    const shape = vectorShapesRef.current[idx];
    shape.anchors = shape.anchors.filter((_, i) => i !== index);
    if (shape.anchors.length < 2) {
      vectorShapesRef.current = vectorShapesRef.current.filter((s) => s.id !== shapeId);
      setGlyphs((gs) =>
        gs
          .map((g) => (g.vectorShapeIds?.includes(shapeId) ? { ...g, vectorShapeIds: g.vectorShapeIds.filter((id) => id !== shapeId) } : g))
          .filter((g) => g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0)
      );
      editingShapeIdRef.current = null;
    }
    saveVectorShapes(vectorShapesRef.current);
  }

  // Mirrors the Free-stroke provenance push (see onPointerUp above) but per
  // anchor placed rather than per finished stroke — a vector shape has no
  // pressure data, so pointCount is pinned to 1 and pressure fields to a
  // neutral constant rather than adding a second summarizer.
  function recordVectorProvenance() {
    enqueueProvenanceEvent({
      draftId: getDraftId(),
      authorId: getAuthorId(),
      clientStrokeId: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      context: "free",
      tool: "vector",
      ...summarizeStroke([[0, 0, 1]], Date.now()),
    });
    trackToolUse("vector", viewLabelRef.current);
  }

  // Illustrator's tangent continuity, entered from every gesture that starts a
  // handle drag. Resolving smoothness HERE and writing it back is the whole
  // trick: isSmoothAnchor's geometric fallback reads the handles' current
  // directions, and the first pointermove destroys that evidence — so the flag
  // has to become authoritative before the drag mutates anything. `breakPair`
  // is Illustrator's Alt-drag (and the Convert tool's plain drag): it snaps
  // the point to a corner up front, so only the dragged side moves from here.
  function beginVectorHandleDrag(anchor: BezierAnchor, breakPair: boolean) {
    anchor.smooth = breakPair ? false : isSmoothAnchor(anchor);
  }

  // Illustrator's three Pen-submenu tools. Unlike the pen itself they act on
  // whatever shape is under the cursor rather than on the current editing
  // session, and the shape they hit becomes the edited one — its anchors and
  // handles are the only ones drawn, so you need the click to target it.
  // Topmost (last-drawn) shape wins, same convention as the Eraser.
  function handleVectorAnchorToolPointerDown(x: number, y: number, tool: DrawTool) {
    for (let i = vectorShapesRef.current.length - 1; i >= 0; i--) {
      const shape = vectorShapesRef.current[i];

      // Convert only: dragging an EXISTING handle breaks the pair, exactly
      // like Alt-dragging it with the pen.
      if (tool === "vectorConvert") {
        const handleHit = vectorHandleNear(shape, x, y);
        if (handleHit) {
          editingShapeIdRef.current = shape.id;
          beginVectorHandleDrag(shape.anchors[handleHit.anchorIndex], true);
          draggingHandleRef.current = handleHit;
          vectorDragStartRef.current = { x, y };
          return;
        }
      }

      const anchorHit = vectorAnchorNear(shape, x, y);
      if (anchorHit !== null) {
        editingShapeIdRef.current = shape.id;
        if (tool === "vectorDelete") {
          deleteVectorAnchorAt(shape.id, anchorHit);
          return;
        }
        if (tool === "vectorConvert") {
          // Illustrator's Anchor Point tool in one gesture: dragging pulls a
          // fresh symmetric handle pair out (smooth), releasing without
          // moving retracts them (corner). That's exactly the
          // placingNewAnchorRef gesture a freshly placed pen anchor already
          // uses — including the pointerup that collapses it back to a corner
          // — so it's reused rather than re-implemented.
          draggingHandleRef.current = { anchorIndex: anchorHit, which: "handleOut" };
          placingNewAnchorRef.current = true;
          vectorDragStartRef.current = { x, y };
        }
        // Add Anchor on an anchor that already exists: nothing to add, the
        // click just selects the shape.
        return;
      }

      if (tool === "vectorAdd") {
        const segHit = vectorSegmentHit(shape, x, y);
        if (segHit) {
          editingShapeIdRef.current = shape.id;
          insertVectorAnchorOnCurve(shape.id, segHit.index, segHit.t);
          return;
        }
      }
    }
  }

  // Click on an existing anchor selects its shape for editing UNLESS the
  // click turns into a drag (moved past ANCHOR_HIT_PX before pointerup) —
  // then it repositions instead. Click on the first anchor of the
  // currently-open path closes it; click on its LAST anchor retracts that
  // anchor's outgoing handle so the next segment leaves straight (both
  // Illustrator pen behaviors). Click on empty space while a path is open
  // extends it (drag = curve point, plain click = corner). Click on a
  // different existing shape's anchor/curve (or on empty space with nothing
  // active) starts/switches the editing session onto it, exactly the
  // Nudge/Anchor tools' own convention.
  //
  // `directSelect` (Cmd/Ctrl held) is Illustrator's momentary Direct
  // Selection tool, for the WHOLE pen family: existing geometry stays
  // grabbable (the handle-hit and anchor-drag branches below), but nothing
  // new can happen — close-path, segment-insert, append-anchor and new-shape
  // creation are all skipped, so a Cmd-click on empty space is a no-op.
  function handleVectorPointerDown(x: number, y: number, altKey: boolean, tool: DrawTool, directSelect: boolean) {
    if (tool !== "vector" && !directSelect) {
      handleVectorAnchorToolPointerDown(x, y, tool);
      return;
    }
    if (editingShapeIdRef.current) {
      const idx = vectorShapesRef.current.findIndex((s) => s.id === editingShapeIdRef.current);
      if (idx !== -1) {
        const shape = vectorShapesRef.current[idx];

        const handleHit = vectorHandleNear(shape, x, y);
        if (handleHit) {
          // Alt breaks the handle pair (Illustrator's cusp gesture); a plain
          // drag keeps a smooth point smooth — see beginVectorHandleDrag.
          beginVectorHandleDrag(shape.anchors[handleHit.anchorIndex], altKey);
          draggingHandleRef.current = handleHit;
          vectorDragStartRef.current = { x, y };
          return;
        }

        if (!directSelect && !shape.closed && shape.anchors.length >= 3) {
          const first = shape.anchors[0];
          if (Math.hypot(x - first.x, y - first.y) <= ANCHOR_HIT_PX) {
            shape.closed = true;
            saveVectorShapes(vectorShapesRef.current);
            editingShapeIdRef.current = null;
            return;
          }
        }

        const anchorHit = vectorAnchorNear(shape, x, y);
        if (anchorHit !== null) {
          // Arms the palette's "Toggle smooth" button (see the Path
          // section) — same in the fallback scan loop below.
          lastClickedAnchorIndexRef.current = anchorHit;
          if (altKey) {
            // Alt+drag pulls a fresh symmetric handle pair out of ANY
            // anchor — including the first/last point of the path, which
            // otherwise never gets a drag-to-curve moment of its own — same
            // mechanism as placing a brand-new curve point, just retargeted
            // at an anchor that already exists.
            draggingHandleRef.current = { anchorIndex: anchorHit, which: "handleOut" };
            placingNewAnchorRef.current = true;
            vectorDragStartRef.current = { x, y };
            return;
          }
          draggingVectorAnchorRef.current = anchorHit;
          vectorDragStartRef.current = { x, y };
          return;
        }

        if (!directSelect) {
          const segHit = vectorSegmentHit(shape, x, y);
          if (segHit) {
            insertVectorAnchorOnCurve(shape.id, segHit.index, segHit.t);
            return;
          }
        }

        if (!shape.closed) {
          // Direct-select never extends the path — with nothing grabbable
          // under the cursor the click is a no-op, and the open session
          // survives untouched.
          if (directSelect) return;
          // Shift-click = Illustrator's 45°-constrained segment: the new
          // anchor lands snapped around the PREVIOUS anchor; a drag that
          // follows constrains its handles separately (see
          // handleVectorPointerMove). Read live from heldKeys so the
          // signature stays identical to GridCell's copy.
          const prev = shape.anchors[shape.anchors.length - 1];
          const pt = getHeldKeys().shift ? constrainTo45(prev.x, prev.y, x, y) : { x, y };
          shape.anchors = [...shape.anchors, { x: pt.x, y: pt.y }];
          draggingHandleRef.current = { anchorIndex: shape.anchors.length - 1, which: "handleOut" };
          placingNewAnchorRef.current = true;
          vectorDragStartRef.current = { x, y };
          saveVectorShapes(vectorShapesRef.current);
          recordVectorProvenance();
          return;
        }

        // Closed shape, click elsewhere on it: stop editing, fall through to
        // check other shapes / empty space below. Direct-select instead
        // keeps the session — deselecting is not what a missed Cmd-grab
        // should do.
        if (!directSelect) editingShapeIdRef.current = null;
      }
    }

    for (let i = vectorShapesRef.current.length - 1; i >= 0; i--) {
      const shape = vectorShapesRef.current[i];
      const handleHit = vectorHandleNear(shape, x, y);
      if (handleHit) {
        editingShapeIdRef.current = shape.id;
        beginVectorHandleDrag(shape.anchors[handleHit.anchorIndex], altKey);
        draggingHandleRef.current = handleHit;
        vectorDragStartRef.current = { x, y };
        return;
      }
      const anchorHit = vectorAnchorNear(shape, x, y);
      if (anchorHit !== null) {
        editingShapeIdRef.current = shape.id;
        lastClickedAnchorIndexRef.current = anchorHit;
        if (altKey) {
          draggingHandleRef.current = { anchorIndex: anchorHit, which: "handleOut" };
          placingNewAnchorRef.current = true;
          vectorDragStartRef.current = { x, y };
          return;
        }
        draggingVectorAnchorRef.current = anchorHit;
        vectorDragStartRef.current = { x, y };
        return;
      }
      if (!directSelect) {
        const segHit = vectorSegmentHit(shape, x, y);
        if (segHit) {
          editingShapeIdRef.current = shape.id;
          insertVectorAnchorOnCurve(shape.id, segHit.index, segHit.t);
          return;
        }
      }
    }

    // Direct-select on empty space: a no-op, never a fresh path.
    if (directSelect) return;

    const newShape: VectorShape = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      anchors: [{ x, y }],
      closed: false,
      createdAt: Date.now(),
      renderMode: settingsRef.current.vectorRenderMode,
      strokeWidth: settingsRef.current.vectorStrokeWidth,
    };
    vectorShapesRef.current = [...vectorShapesRef.current, newShape];
    editingShapeIdRef.current = newShape.id;
    // The very first point of a path gets the same drag-to-curve treatment
    // every later point already had — previously only anchors 2+ could
    // become smooth points on placement.
    draggingHandleRef.current = { anchorIndex: 0, which: "handleOut" };
    placingNewAnchorRef.current = true;
    vectorDragStartRef.current = { x, y };
    saveVectorShapes(vectorShapesRef.current);
    recordVectorProvenance();
  }

  function handleVectorPointerMove(x: number, y: number) {
    const idx = vectorShapesRef.current.findIndex((s) => s.id === editingShapeIdRef.current);
    if (idx === -1) return;
    const shape = vectorShapesRef.current[idx];

    if (draggingHandleRef.current) {
      const { anchorIndex, which } = draggingHandleRef.current;
      const anchor = shape.anchors[anchorIndex];
      // Shift = Illustrator's 45° constraint, read live (heldKeys) so it can
      // be pressed/released mid-drag: the dragged handle snaps around its
      // own anchor, whichever of the two branches below is running.
      const p = getHeldKeys().shift ? constrainTo45(anchor.x, anchor.y, x, y) : { x, y };
      if (placingNewAnchorRef.current) {
        // Symmetric: dragging out from a freshly-placed anchor (or from a
        // corner with the Convert tool) sets both handles at once, mirrored —
        // that IS a smooth curve point, so record it as one.
        anchor.handleOut = { x: p.x, y: p.y };
        anchor.handleIn = { x: anchor.x - (p.x - anchor.x), y: anchor.y - (p.y - anchor.y) };
        anchor.smooth = true;
      } else {
        anchor[which] = { x: p.x, y: p.y };
        // Illustrator's tangent continuity on a smooth point: the opposite
        // handle swings to stay collinear but keeps its own length. A corner
        // (including one just broken by Alt or the Convert tool, which
        // beginVectorHandleDrag already flagged) moves one side only.
        if (anchor.smooth) alignOppositeHandle(anchor, which);
      }
      redrawRef.current();
      return;
    }

    if (draggingVectorAnchorRef.current !== null) {
      const start = vectorDragStartRef.current;
      if (start && Math.hypot(x - start.x, y - start.y) > ANCHOR_HIT_PX) {
        const anchor = shape.anchors[draggingVectorAnchorRef.current];
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        anchor.x = x;
        anchor.y = y;
        if (anchor.handleIn) {
          anchor.handleIn = { x: anchor.handleIn.x + dx, y: anchor.handleIn.y + dy };
        }
        if (anchor.handleOut) {
          anchor.handleOut = { x: anchor.handleOut.x + dx, y: anchor.handleOut.y + dy };
        }
        redrawRef.current();
      }
    }
  }

  function handleVectorPointerUp(x: number, y: number) {
    const idx = vectorShapesRef.current.findIndex((s) => s.id === editingShapeIdRef.current);
    const shape = idx !== -1 ? vectorShapesRef.current[idx] : null;
    const start = vectorDragStartRef.current;
    const moved = start ? Math.hypot(x - start.x, y - start.y) : 0;

    if (shape && draggingHandleRef.current) {
      if (placingNewAnchorRef.current && moved <= ANCHOR_HIT_PX) {
        // Released without dragging — a plain click, so this anchor is a
        // corner, not a curve point. Discard the handles set on pointerdown.
        // This is also the Convert tool's click behavior: a smooth point
        // clicked (not dragged) loses both handles and becomes a corner.
        const anchor = shape.anchors[draggingHandleRef.current.anchorIndex];
        anchor.handleIn = undefined;
        anchor.handleOut = undefined;
        anchor.smooth = false;
      }
      saveVectorShapes(vectorShapesRef.current);
    } else if (shape && draggingVectorAnchorRef.current !== null) {
      const index = draggingVectorAnchorRef.current;
      if (moved <= ANCHOR_HIT_PX) {
        // A click, not a drag. Deleting the anchor used to happen here; that's
        // the Delete Anchor tool's job now, and the pen instead follows
        // Illustrator: clicking the open path's own last anchor retracts its
        // outgoing handle, so the next segment leaves it straight. Clicking
        // any other anchor just selects the shape (pointerdown already did).
        if (!shape.closed && index === shape.anchors.length - 1) {
          const anchor = shape.anchors[index];
          anchor.handleOut = undefined;
          anchor.smooth = false;
          saveVectorShapes(vectorShapesRef.current);
        } else if (PEN_ANCHOR_CLICK === "delete") {
          // Dormant behind cursors.ts's flag (the user chose "select"):
          // Glyphs' click-deletes-anchor variant, kept wired so flipping the
          // constant is the whole change.
          deleteVectorAnchorAt(shape.id, index);
        }
      } else {
        saveVectorShapes(vectorShapesRef.current);
      }
    }

    draggingHandleRef.current = null;
    draggingVectorAnchorRef.current = null;
    placingNewAnchorRef.current = false;
    vectorDragStartRef.current = null;
    redrawRef.current();
  }

  // Glyphs' double-click parity: toggle the anchor under the cursor between
  // smooth and corner (see toggleAnchorSmooth) without reaching for the
  // Convert tool. The dblclick's two constituent clicks have already run the
  // normal pointer path (selecting the shape, possibly retracting a last
  // anchor's handle) — a known, acceptable quirk: the toggle lands last and
  // wins. Topmost shape first, same convention as every other vector hit-test.
  function handleVectorDblClick(x: number, y: number) {
    if (topModeRef.current !== "draw" || !VECTOR_TOOLS.has(drawToolRef.current)) return;
    for (let i = vectorShapesRef.current.length - 1; i >= 0; i--) {
      const shape = vectorShapesRef.current[i];
      const anchorHit = vectorAnchorNear(shape, x, y);
      if (anchorHit === null) continue;
      if (toggleAnchorSmooth(shape.anchors[anchorHit])) {
        saveVectorShapes(vectorShapesRef.current);
        redrawRef.current();
      }
      // The toggle changes the Path section's smooth/corner tally, and the
      // dblclick fires AFTER its two constituent clicks already synced.
      syncVectorPanelInfo();
      return;
    }
  }

  // The Path section's "Toggle smooth" button — the same smooth/corner flip
  // as double-clicking the anchor (Glyphs offers both routes too), aimed at
  // the anchor the last Free-canvas click landed on. Bounds-checked because
  // the ref can outlive the anchor it named (e.g. Delete Anchor removed it).
  function handleToggleSmoothClick() {
    const shape = vectorShapesRef.current.find((s) => s.id === editingShapeIdRef.current);
    const index = lastClickedAnchorIndexRef.current;
    if (!shape || index === null) return;
    const anchor = shape.anchors[index];
    if (!anchor) return;
    if (toggleAnchorSmooth(anchor)) {
      saveVectorShapes(vectorShapesRef.current);
      redrawRef.current();
      syncVectorPanelInfo();
    }
  }

  // Hover-contextual pen cursor (cursors.ts): what WOULD a click do right
  // here? Mirrors handleVectorPointerDown's branch order — close beats
  // continue beats plain anchor beats segment-insert — so the badge never
  // promises something the click won't deliver. Cmd/Ctrl flips the whole
  // family into direct-select, hence the plain arrow.
  function vectorHoverCursor(x: number, y: number): string {
    const held = getHeldKeys();
    if (held.meta || held.ctrl) return "default";
    const editing = vectorShapesRef.current.find((s) => s.id === editingShapeIdRef.current);
    for (let i = vectorShapesRef.current.length - 1; i >= 0; i--) {
      const shape = vectorShapesRef.current[i];
      const anchorHit = vectorAnchorNear(shape, x, y);
      if (anchorHit === null) continue;
      if (editing && shape.id === editing.id && !editing.closed) {
        if (anchorHit === 0 && shape.anchors.length >= 3) return PEN_CLOSE;
        if (anchorHit === shape.anchors.length - 1) return PEN_CONTINUE;
      }
      // Alt over a smooth point = the cusp-break gesture (Convert's caret).
      if (held.alt && isSmoothAnchor(shape.anchors[anchorHit])) return CONVERT;
      return PEN_ANCHOR_CLICK === "delete" ? PEN_MINUS : "default";
    }
    if (editing && vectorSegmentHit(editing, x, y)) return PEN_ADD;
    return PEN;
  }

  // Move/Rotate/Scale click: the pointerdown must land on a stroke that's
  // already part of selectedIds (populated by Select/Assign's lasso first) —
  // clicking an unselected stroke or empty space is a no-op, same "you pick
  // your selection separately, then act on it" split as Figma/Illustrator.
  // On a hit, the anchor and a frozen snapshot of every selected stroke's
  // points are captured once; every subsequent pointermove recomputes from
  // that snapshot rather than the live (already-mutated) points, same shape
  // as Nudge's per-anchor drag above, just applied to a whole selection at
  // once. For Scale, the anchor is the selection's bbox bottom-left by
  // default, or its center if Alt is held (Alt preserves what used to be the
  // only behavior); Shift locks the gesture to uniform scaling. Move/Rotate
  // ignore both modifiers — only Scale's anchor/uniformity changes here.
  function handleTransformPointerDown(
    x: number,
    y: number,
    mode: "move" | "rotate" | "scale",
    altKey: boolean,
    shiftKey: boolean
  ) {
    let hit = false;
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      if (selectedIdsRef.current.has(completedRef.current[i].id) && pointInPolygon([x, y], outlinesRef.current[i].envelope)) {
        hit = true;
        break;
      }
    }
    if (!hit) return;
    pushUndoSnapshot();

    const selected = completedRef.current.filter((s) => selectedIdsRef.current.has(s.id));
    const anchor = mode === "scale" && !altKey ? selectionBottomLeft(selected) : selectionPivot(selected);
    const snapshot = new Map(selected.map((s) => [s.id, s.points.map((p) => [...p] as StrokePoint)]));
    transformStartRef.current = {
      mode,
      pivotX: anchor.x,
      pivotY: anchor.y,
      startX: x,
      startY: y,
      startDist: Math.max(Math.hypot(x - anchor.x, y - anchor.y), 1),
      startAngle: Math.atan2(y - anchor.y, x - anchor.x),
      startDx: x - anchor.x,
      startDy: y - anchor.y,
      uniform: shiftKey,
      lastScaleX: 1,
      lastScaleY: 1,
      snapshot,
      currentX: x,
      currentY: y,
    };
  }

  // Applies the live pointer position against the frozen snapshot/anchor
  // captured above, for whichever of Move/Rotate/Scale is active. Mutates
  // completedRef's strokes + outlinesRef in place (mirroring every other
  // in-place stroke edit in this file) and leaves saving for pointerup.
  function applyTransform(x: number, y: number) {
    const t = transformStartRef.current;
    if (!t) return;
    t.currentX = x;
    t.currentY = y;
    const dx = x - t.startX;
    const dy = y - t.startY;
    const angle = Math.atan2(y - t.pivotY, x - t.pivotX) - t.startAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Non-uniform scale: independent x/y ratios from the anchor, signed so a
    // corner drag can pull past the anchor (mirroring the shape), same as a
    // vector editor's corner handle. Shift (t.uniform) collapses both back
    // to the single hypot-ratio factor Scale always used before this change.
    const SCALE_EPS = 1;
    const dxNow = x - t.pivotX;
    const dyNow = y - t.pivotY;
    const uniformFactor = Math.max(Math.hypot(dxNow, dyNow), 1) / t.startDist;
    const rawScaleX = Math.abs(t.startDx) < SCALE_EPS ? 1 : dxNow / t.startDx;
    const rawScaleY = Math.abs(t.startDy) < SCALE_EPS ? 1 : dyNow / t.startDy;
    const scaleX = t.uniform ? uniformFactor : rawScaleX;
    const scaleY = t.uniform ? uniformFactor : rawScaleY;
    t.lastScaleX = scaleX;
    t.lastScaleY = scaleY;

    for (const [id, points] of t.snapshot) {
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      const stroke = completedRef.current[idx];
      stroke.points = points.map(([px, py, pressure]) => {
        if (t.mode === "move") return [px + dx, py + dy, pressure] as StrokePoint;
        if (t.mode === "rotate") {
          const ox = px - t.pivotX;
          const oy = py - t.pivotY;
          return [t.pivotX + ox * cos - oy * sin, t.pivotY + ox * sin + oy * cos, pressure] as StrokePoint;
        }
        // scale
        return [t.pivotX + (px - t.pivotX) * scaleX, t.pivotY + (py - t.pivotY) * scaleY, pressure] as StrokePoint;
      });
      outlinesRef.current[idx] = strokeOutline(stroke, settingsRef.current);
    }
  }

  function handleGridStroke(
    slot: GridSlot,
    stroke: Stroke,
    currentCellWidth: number,
    currentCellHeight: number,
    durationMs: number
  ) {
    pushUndoSnapshot();
    // Convert to the glyph's existing anchor space (if it already has one)
    // before storing, so this stroke stays geometrically consistent with
    // whatever other strokes it already has — even if Cell size/width has
    // changed since those were drawn. See fromAnchorSpace/toAnchorSpace.
    const existingGlyph = glyphsRef.current.find((g) => g.kind === slot.kind && g.name === slot.name);
    // A new glyph's anchor is the canonical space, not the pixels this cell
    // happens to occupy at the current zoom — that is the whole point of the
    // zoom rewrite. An existing glyph keeps whatever anchor it already has,
    // including the pre-zoom ones, so nothing already drawn moves.
    const anchorWidth = existingGlyph?.cellWidth ?? currentCellWidth / zoom;
    const anchorHeight = existingGlyph?.cellHeight ?? currentCellHeight / zoom;
    const anchoredPoints = toAnchorSpace(
      stroke.points,
      anchorWidth,
      anchorHeight,
      currentCellWidth,
      currentCellHeight,
      keepProportions
    );
    const anchoredStroke = anchoredPoints === stroke.points ? stroke : { ...stroke, points: anchoredPoints };
    completedRef.current = [...completedRef.current, anchoredStroke];
    outlinesRef.current = [...outlinesRef.current, strokeOutline(anchoredStroke, settingsRef.current)];
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    enqueueProvenanceEvent({
      draftId: getDraftId(),
      authorId: getAuthorId(),
      clientStrokeId: anchoredStroke.id,
      context: "grid",
      tool: anchoredStroke.kind ?? "pen",
      // durationMs was measured directly by GridCell (only it knows its own
      // pointerdown time) — reproduced here via summarizeStroke's own
      // Date.now()-startedAt math rather than adding a second code path.
      ...summarizeStroke(anchoredStroke.points, Date.now() - durationMs),
    });

    // Grid drawing fuses capture + tagging: the cell you draw into IS the
    // glyph, no separate lasso-select step. First stroke creates the glyph,
    // later strokes into the same cell just add to it.
    setGlyphs((gs) => {
      const existing = gs.find((g) => g.kind === slot.kind && g.name === slot.name);
      if (existing) {
        return gs.map((g) => (g.id === existing.id ? { ...g, strokeIds: [...g.strokeIds, anchoredStroke.id] } : g));
      }
      const glyph: Glyph = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        name: slot.name,
        kind: slot.kind,
        strokeIds: [anchoredStroke.id],
        createdAt: Date.now(),
        leftBearing: DEFAULT_LEFT_BEARING,
        rightBearing: DEFAULT_RIGHT_BEARING,
        cellWidth: anchorWidth,
        cellHeight: anchorHeight,
        ...(slot.kind === "base" ? { unicode: unicodeFor(slot.name) } : {}),
        ...(slot.kind === "ligature" ? { components: slot.components ?? [] } : {}),
        ...(slot.kind === "alternate" ? { alternateOf: slot.alternateOf } : {}),
      };
      return [...gs, glyph];
    });
  }

  // Undo the one thing the Cell size slider silently does to stroke weight.
  //
  // A glyph stores the cell size it was drawn at, and display rescales it to
  // whatever the cell measures now — points AND width (anchorSpaceWidthScale).
  // So the pen's weight RELATIVE TO THE LETTER is fixed at drawing time by the
  // cell size: draw one syllable at cell 80 and the next at 210 and the first
  // one keeps a 2.6x heavier stroke forever, through every export. Nothing in
  // the UI says so, and for a font — where one weight across the alphabet is
  // the whole job — it is the most expensive kind of invisible.
  //
  // This rewrites each glyph's widthScale to A/reference, which is the value
  // that would have made every glyph weigh the same regardless of the cell it
  // was drawn in. Geometry is untouched; only thickness moves.
  //
  // It overwrites a widthScale the Scale tool may have baked deliberately —
  // there is no way to tell the two apart after the fact — so it is a button
  // someone presses, never something that runs on its own. Undo covers it.
  function evenOutStrokeWeights() {
    const reference = cellSize;
    const mine = glyphs.filter(
      (g) => slotScript(g.name) === activeScript && g.cellWidth && g.cellHeight && g.strokeIds.length > 0
    );
    const wanted = new Map<string, number>();
    for (const g of mine) {
      // Geometric mean of the anchor's two axes — the same convention
      // anchorSpaceWidthScale uses to turn a two-axis rescale into one width
      // factor, so this cancels it exactly instead of approximately.
      const anchor = Math.sqrt((g.cellWidth as number) * (g.cellHeight as number));
      for (const id of g.strokeIds) wanted.set(id, anchor / reference);
    }
    if (wanted.size === 0) return;
    const changed = completedRef.current.some(
      (s) => wanted.has(s.id) && Math.abs((s.widthScale ?? 1) - (wanted.get(s.id) as number)) > 1e-6
    );
    if (!changed) return;
    pushUndoSnapshot();
    completedRef.current = completedRef.current.map((s) =>
      wanted.has(s.id) ? { ...s, widthScale: wanted.get(s.id) as number } : s
    );
    outlinesRef.current = completedRef.current.map((s) => strokeOutline(s, settingsRef.current));
    saveStrokes(completedRef.current);
    // Strokes live in a ref, so nothing re-renders on its own — and the count
    // is unchanged, so setStrokeCount wouldn't either. Same handle
    // handleGridStrokesChange uses: a fresh glyphs array.
    setGlyphs((gs) => [...gs]);
  }

  // GridCell's Vector tool reports this cell's ENTIRE shape list on every
  // commit (anchor placed, path closed, handle dragged, anchor/shape deleted)
  // rather than a delta — the cell owns the live anchors, this owns
  // persistence and the glyph tagging, the same "drawing IS tagging" fusion
  // handleGridStroke does for strokes. Deliberately outside the undo history,
  // exactly like Free's own Vector handlers: snapshotNow() only captures
  // strokes and glyphs, so an undo across a vector edit would restore the
  // glyph without restoring the shape it points at.
  function handleGridVectorShapes(
    slot: GridSlot,
    shapes: VectorShape[],
    currentCellWidth: number,
    currentCellHeight: number
  ) {
    const glyph = glyphsRef.current.find((g) => g.kind === slot.kind && g.name === slot.name);
    // Which shapes this call replaces. The glyph's own tag list is the primary
    // answer, but the incoming ids have to count too: several commits can land
    // before setGlyphs below has re-rendered (a pointerdown that places an
    // anchor and the pointerup that finishes it are two commits, and the very
    // first one is what CREATES the glyph), and going by a not-yet-updated tag
    // list alone would re-append the same shape instead of replacing it.
    const incomingIds = new Set(shapes.map((s) => s.id));
    const replacedIds = new Set([...(glyph?.vectorShapeIds ?? []), ...incomingIds]);
    // Same conversion handleGridStroke runs on points: the cell works in
    // current-cell pixel space, the store keeps everything in the glyph's own
    // fixed anchor space so a later Cell size/width change rescales a glyph's
    // shapes and strokes together instead of drifting them apart.
    // Same canonical anchor a first stroke would establish (see
    // handleGridStroke) — a glyph that starts life as vector shapes must land
    // in the same space as one that starts as ink, or the two would carry
    // different weights the moment both exist.
    const anchorWidth = glyph?.cellWidth ?? currentCellWidth / zoom;
    const anchorHeight = glyph?.cellHeight ?? currentCellHeight / zoom;
    const anchored = shapes.map((s) =>
      vectorShapeAcrossAnchorSpace(
        s,
        anchorWidth,
        anchorHeight,
        currentCellWidth,
        currentCellHeight,
        keepProportions,
        true
      )
    );

    // One provenance event per anchor just placed — the same per-anchor
    // granularity as Free's recordVectorProvenance(), reconstructed from the
    // anchor-count delta since the cell reports whole shapes rather than
    // individual actions. Deletions (a negative delta) record nothing, same
    // as Free.
    const anchorsBefore = vectorShapesRef.current
      .filter((s) => replacedIds.has(s.id))
      .reduce((n, s) => n + s.anchors.length, 0);
    const anchorsAfter = anchored.reduce((n, s) => n + s.anchors.length, 0);

    vectorShapesRef.current = [...vectorShapesRef.current.filter((s) => !replacedIds.has(s.id)), ...anchored];
    saveVectorShapes(vectorShapesRef.current);

    for (let i = 0; i < anchorsAfter - anchorsBefore; i++) {
      enqueueProvenanceEvent({
        draftId: getDraftId(),
        authorId: getAuthorId(),
        clientStrokeId: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        context: "grid",
        tool: "vector",
        // A vector shape has no pressure data, so pointCount is pinned to 1
        // and the pressure fields to a neutral constant — same shortcut
        // recordVectorProvenance takes on the Free canvas.
        ...summarizeStroke([[0, 0, 1]], Date.now()),
      });
      trackToolUse("vector", viewLabelRef.current);
    }

    const shapeIds = anchored.map((s) => s.id);
    setGlyphs((gs) => {
      const existing = gs.find((g) => g.kind === slot.kind && g.name === slot.name);
      if (existing) {
        return (
          gs
            .map((g) => (g.id === existing.id ? { ...g, vectorShapeIds: shapeIds } : g))
            // Deleting a cell's last shape can leave a glyph referencing
            // nothing at all — dropped, same rule Free's deleteVectorAnchorAt
            // applies and the same one deleteStrokes uses for strokes.
            .filter((g) => g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0)
        );
      }
      if (shapeIds.length === 0) return gs;
      const glyph: Glyph = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        name: slot.name,
        kind: slot.kind,
        strokeIds: [],
        vectorShapeIds: shapeIds,
        createdAt: Date.now(),
        leftBearing: DEFAULT_LEFT_BEARING,
        rightBearing: DEFAULT_RIGHT_BEARING,
        cellWidth: anchorWidth,
        cellHeight: anchorHeight,
        ...(slot.kind === "base" ? { unicode: unicodeFor(slot.name) } : {}),
        ...(slot.kind === "ligature" ? { components: slot.components ?? [] } : {}),
        ...(slot.kind === "alternate" ? { alternateOf: slot.alternateOf } : {}),
      };
      return [...gs, glyph];
    });
  }

  // Commits a GridCell-side Nudge/Move/Rotate/Scale edit back into the
  // shared stroke store. Mirrors the direct in-place mutation style Free's
  // own Nudge/transform tools already use (patch by index, then save) —
  // just driven by ids reported up from the cell instead of a local ref.
  function handleGridStrokesChange(
    slot: GridSlot,
    updates: { id: string; points: StrokePoint[]; widthScale?: number }[],
    currentCellWidth: number,
    currentCellHeight: number
  ) {
    if (updates.length === 0) return;
    pushUndoSnapshot();
    const glyph = glyphsRef.current.find((g) => g.kind === slot.kind && g.name === slot.name);
    // A glyph with no anchor yet (Free-tagged, being promoted below) gets the
    // canonical one, so the points written back are stored in the same space
    // every Grid-drawn glyph uses rather than in whatever pixels the current
    // zoom happens to be showing.
    const anchorWidth = glyph?.cellWidth ?? currentCellWidth / zoom;
    const anchorHeight = glyph?.cellHeight ?? currentCellHeight / zoom;
    for (const { id, points: rawPoints, widthScale } of updates) {
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      // Same anchor conversion as handleGridStroke — GridCell reports these
      // points in current-cell pixel space, but they need to land back in
      // the glyph's own fixed anchor space so fromAnchorSpace can keep
      // expanding the whole glyph consistently on every future render.
      const points = toAnchorSpace(
        rawPoints,
        anchorWidth,
        anchorHeight,
        currentCellWidth,
        currentCellHeight,
        keepProportions
      );
      completedRef.current[idx] = { ...completedRef.current[idx], points, ...(widthScale !== undefined ? { widthScale } : {}) };
      outlinesRef.current[idx] = strokeOutline(completedRef.current[idx], settingsRef.current);
    }
    saveStrokes(completedRef.current);

    // A GridCell-side edit mutates whatever's currently displayed there —
    // for a Free-tagged (bbox-fallback) glyph that's the FITTED points, not
    // its original Free-canvas coordinates. Writing those back as the
    // glyph's real points while it's still flagged as "needs fitting" would
    // re-fit an already-fitted shape and drift further on every edit.
    // Promoting it to Grid-native (same cellWidth/cellHeight a fresh
    // Grid-drawn stroke gets) the moment it's edited here fixes its
    // anchor space for good — later renders/edits then rescale off of it.
    setGlyphs((gs) =>
      gs.map((g) =>
        g.kind === slot.kind && g.name === slot.name && !(g.cellWidth && g.cellHeight)
          ? { ...g, cellWidth: anchorWidth, cellHeight: anchorHeight }
          : g
      )
    );
  }

  function handleBearingsChange(slot: GridSlot, left: number, right: number) {
    setGlyphs((gs) =>
      gs.map((g) => (g.kind === slot.kind && g.name === slot.name ? { ...g, leftBearing: left, rightBearing: right } : g))
    );
  }

  // Dragging a cell's width handle reports a final pixel width — stored as
  // a ratio of cellSize (same unit as the global Width slider) so it keeps
  // making sense if the user later changes Cell size too.
  function handleGlyphWidthChange(slot: GridSlot, newWidthPx: number) {
    const newRatio = Math.max(newWidthPx / cellSize, 0.2);
    setGlyphs((gs) =>
      gs.map((g) => (g.kind === slot.kind && g.name === slot.name ? { ...g, widthRatio: newRatio } : g))
    );
  }

  // Double-clicking the handle drops the override — the cell goes back to
  // following the global Width slider like every other un-overridden one.
  function handleGlyphWidthReset(slot: GridSlot) {
    setGlyphs((gs) =>
      gs.map((g) => {
        if (g.kind !== slot.kind || g.name !== slot.name) return g;
        const { widthRatio: _widthRatio, ...rest } = g;
        return rest;
      })
    );
  }

  // How many glyphs the document actually has something in — strokes or
  // vector shapes, either counts. Sent with every export as one of five
  // buckets (never the number itself, see lib/analytics.ts): the difference
  // between "tried three letters" and "built a typeface" is the whole
  // question of what this tool is for, and no other event answers it.
  const drawnGlyphCount = glyphs.filter((g) => g.strokeIds.length > 0 || (g.vectorShapeIds?.length ?? 0) > 0).length;

  // Syllables are composed here, at the moment of export, and never before:
  // 2.350 of them would make the live compile effect (which runs on every
  // stroke) unusable, and they'd have to be thrown away again on the next
  // edit. A font with no drawn jamo passes straight through.
  function composedExportDoc() {
    if (!exportDoc) return exportDoc;
    return composeHangul(exportDoc);
  }

  function handleDownloadJson() {
    trackExport("json", drawnGlyphCount);
    const doc = composedExportDoc();
    const blob = new Blob([doc ? JSON.stringify(doc, null, 2) : exportJson], { type: "application/json" });
    saveFile(blob, {
      suggestedName: "fontane-document.json",
      mimeType: "application/json",
      extension: "json",
      description: "Fontane document",
    });
  }

  function handleExportOtf() {
    if (!exportDoc) return;
    trackExport("otf", drawnGlyphCount);
    // The export event above fires on the click, so a build that throws
    // would otherwise be indistinguishable from a finished download — the
    // one place where "used" and "worked" quietly diverge.
    try {
      downloadFont(composedExportDoc()!, "fontane.otf");
    } catch (err) {
      trackError("export:otf");
      throw err; // reporting it must not also swallow it
    }
  }

  function handleExportSkeleton() {
    trackExport("skeleton-svg", drawnGlyphCount);
    downloadSkeletonSvg(glyphs, completedRef.current);
  }

  function handleDownloadFff() {
    trackExport("fff", drawnGlyphCount);
    downloadProjectFile(glyphs, completedRef.current, vectorShapesRef.current, metrics, settings, "untitled.fff");
  }

  function handleImportFffClick() {
    fffInputRef.current?.click();
  }

  function handleImportFffChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    file.text().then((text) => {
      try {
        applyProjectFile(parseProjectFile(text));
        window.location.reload();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Could not read this file.");
      }
    });
  }

  function handleTraceImportClick() {
    traceInputRef.current?.click();
  }

  function handleTraceImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    if (file.size > TRACE_MAX_FILE_BYTES) {
      alert("This image is larger than 20MB — export a smaller copy and try again.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // An SVG without width/height attributes reports a 0×0 natural size in
      // some browsers — substitute something visible instead of drawing a
      // zero-area image nobody can find on the canvas.
      let width = img.naturalWidth || 512;
      let height = img.naturalHeight || 512;
      let source: CanvasImageSource = img;
      const maxSide = Math.max(width, height);
      if (maxSide > TRACE_MAX_DIMENSION) {
        const shrink = TRACE_MAX_DIMENSION / maxSide;
        const off = document.createElement("canvas");
        off.width = Math.round(width * shrink);
        off.height = Math.round(height * shrink);
        const offCtx = off.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(img, 0, 0, off.width, off.height);
          source = off;
          width = off.width;
          height = off.height;
        }
      }
      traceImageRef.current = { source, width, height };
      // Start scaled to fit the visible canvas and placed near its top-left
      // corner (compensating any current pan), clamped to the offset
      // sliders' range so the sliders can always reach wherever the image
      // actually landed.
      const canvas = canvasRef.current;
      const fit = canvas
        ? Math.min(1, (canvas.clientWidth * 0.9) / width, (canvas.clientHeight * 0.9) / height)
        : 1;
      const pct = Math.max(5, Math.round(fit * 100));
      traceScaleRef.current = pct;
      setTraceScale(pct);
      const clamp = (v: number) => Math.max(-1000, Math.min(1000, Math.round(v)));
      const offset = { x: clamp(24 - panOffsetRef.current.x), y: clamp(24 - panOffsetRef.current.y) };
      traceOffsetRef.current = offset;
      setTraceOffsetState(offset);
      setTraceImageInfo({ name: file.name, width, height });
      redrawRef.current();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert("Could not load this image — use a PNG, JPEG, WebP, GIF or SVG file.");
    };
    img.src = url;
  }

  function removeTraceImage() {
    traceImageRef.current = null;
    setTraceImageInfo(null);
    redrawRef.current();
  }

  function updateTraceOpacity(value: number) {
    traceOpacityRef.current = value;
    setTraceOpacity(value);
    redrawRef.current();
  }

  function updateTraceScale(value: number) {
    traceScaleRef.current = value;
    setTraceScale(value);
    redrawRef.current();
  }

  function updateTraceOffset(axis: "x" | "y", value: number) {
    traceOffsetRef.current = { ...traceOffsetRef.current, [axis]: value };
    setTraceOffsetState(traceOffsetRef.current);
    redrawRef.current();
  }

  // "Yes" saves via the existing Export FFF flow first, "No" skips straight
  // to clearing. Same reset as handleClear, plus metrics/settings back to
  // their defaults — Clear all only ever touched glyphs/strokes since it's
  // scoped to canvas content, but New File means a genuinely blank project.
  function handleNewFile(shouldSave: boolean) {
    if (shouldSave) handleDownloadFff();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    clearStrokes();
    vectorShapesRef.current = [];
    clearVectorShapes();
    exitVectorEditing();
    setStrokeCount(0);
    setGlyphs([]);
    setSelectedIds([]);
    setMetrics(DEFAULT_METRICS);
    saveMetrics(DEFAULT_METRICS);
    setSettings(DEFAULT_SETTINGS);
    setConfirmNewFile(false);
    // A fresh project needs a fresh provenance trail — otherwise whatever
    // accrued for the strokes just cleared could be reused to publish
    // unrelated later work.
    rollDraftId();
    // A blank project isn't the cloud project it might have come from anymore.
    setCurrentCloudProjectPersist(null);
  }

  function setCurrentCloudProjectPersist(project: { id: number; name: string } | null) {
    setCurrentCloudProject(project);
    if (typeof window === "undefined") return;
    if (project) window.localStorage.setItem("fontane.currentCloudProject.v1", JSON.stringify(project));
    else window.localStorage.removeItem("fontane.currentCloudProject.v1");
  }

  // Log in and sign up share one submit (same modal, a tab toggle picks the
  // mode — see cloudModal === "auth" below). Log in runs entirely
  // client-side: signInWithPassword() updates the browser client's session
  // directly, which the onAuthStateChange subscription above already picks
  // up, no manual state sync needed. Sign up has to be a server round-trip
  // instead — the invite code must never be checked (or ship) client-side,
  // see api/auth/signup/route.ts — so afterward this reloads the page
  // rather than trying to hand-sync a session the server just set in a
  // cookie into this tab's already-initialized browser client.
  async function handleAuthSubmit() {
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) return;
    setCloudBusy(true);
    setCloudError(null);
    try {
      if (authMode === "login") {
        const supabase = createBrowserClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setCloudError(error.message);
          return;
        }
        trackAuth("login");
        setCloudModal(null);
        setAuthEmail("");
        setAuthPassword("");
        return;
      }

      const inviteCode = authInviteCode.trim();
      if (!inviteCode) {
        setCloudError("Invite code required.");
        return;
      }
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Not an error to log — a person asking for the thing behind the
        // wall. Which wall, nothing about the code or email they tried.
        if (res.status === 401) trackGate("invite-code");
        setCloudError(typeof data.error === "string" ? data.error : "Sign up failed.");
        return;
      }
      // The account exists either way at this point — track it before
      // branching on whether it's also logged in yet, or a project with
      // "Confirm email" on (as this one turned out to be) would silently
      // undercount every real signup.
      trackAuth("signup");
      if (data.needsConfirmation) {
        setCloudError("Check your email to confirm your account, then log in.");
        setAuthMode("login");
        return;
      }
      window.location.reload();
    } catch {
      setCloudError("Network error — please try again.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleLogOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    setCurrentCloudProjectPersist(null);
  }

  function openSaveToCloud() {
    setCloudSaveAsName(currentCloudProject?.name ?? "untitled");
    setCloudError(null);
    setCloudModal("save");
  }

  async function handleSaveToCloud(asNew: boolean) {
    const name = cloudSaveAsName.trim();
    if (!name || !user) return;
    setCloudBusy(true);
    setCloudError(null);
    try {
      const project = buildProjectFile(glyphs, completedRef.current, vectorShapesRef.current, metrics, settings);
      const body: { name: string; project: unknown; id?: number } = { name, project };
      if (!asNew && currentCloudProject) body.id = currentCloudProject.id;
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloudError(typeof data.error === "string" ? data.error : "Save failed.");
        return;
      }
      trackExport("cloud-save");
      setCurrentCloudProjectPersist({ id: data.project.id, name: data.project.name });
      setCloudModal(null);
    } catch {
      setCloudError("Network error — please try again.");
    } finally {
      setCloudBusy(false);
    }
  }

  function openCloudProjects() {
    setCloudError(null);
    setCloudModal("projects");
  }

  async function handleLoadCloudProject(id: number, name: string) {
    if (!user) return;
    setCloudBusy(true);
    setCloudError(null);
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setCloudError(typeof data.error === "string" ? data.error : "Load failed.");
        return;
      }
      applyProjectFile(data.project.data);
      setCurrentCloudProjectPersist({ id, name });
      window.location.reload();
    } catch {
      setCloudError("Network error — please try again.");
      setCloudBusy(false);
    }
  }

  async function handleDeleteCloudProject(id: number) {
    if (!user) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setCloudProjects((prev) => prev.filter((p) => p.id !== id));
      if (currentCloudProject?.id === id) setCurrentCloudProjectPersist(null);
    } catch {
      // best-effort — the list just won't reflect the delete until reopened
    }
  }

  function closeMarketplaceModal() {
    setMarketplaceModal(null);
    setPublishName("");
    setPublishAuthorName("");
    setPublishAuthorUrl("");
    setSlugCheck(null);
    setSlugChecking(false);
    setLicenseAccepted(false);
    setPublishing(false);
    setPublishError(null);
    setPublishedSlug(null);
    setShareQuery("");
    setShareResults([]);
    setShareSearching(false);
    setShareCopyState("idle");
    setShareCopiedSlug(null);
  }

  async function handlePublish() {
    const trimmed = publishName.trim();
    if (!exportDoc || glyphs.length === 0 || !slugCheck?.available || !licenseAccepted) return;
    setPublishing(true);
    setPublishError(null);
    try {
      // Best-effort: make sure whatever's still queued lands before the
      // server checks for it. If this fails (offline, flaky network), the
      // publish attempt still proceeds — the server just sees a sparser
      // trail and the gate is stricter accordingly, not a hard client-side
      // block.
      await flushProvenanceQueueAndWait();

      // Three steps instead of one, because the font no longer travels
      // through the API route: a serverless request body is capped (4,5 MB on
      // Vercel) and a Korean font is 4–6 MB. The route grants permission,
      // the browser uploads straight to storage, the route then makes it
      // visible. See api/fonts/publish/start.
      const meta = {
        name: trimmed,
        glyphCount: glyphs.length,
        licenseAccepted: true,
        draftId: getDraftId(),
        authorId: getAuthorId(),
        ...(publishAuthorName.trim() ? { authorName: publishAuthorName.trim() } : {}),
        ...(publishAuthorUrl.trim() ? { authorUrl: publishAuthorUrl.trim() } : {}),
      };

      const startRes = await fetch("/api/fonts/publish/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(meta),
      });
      const start = await startRes.json();
      if (!startRes.ok) {
        setPublishError(typeof start.error === "string" ? start.error : "Publish failed.");
        return;
      }

      // Built only once the gate has passed — no point compiling a font
      // nobody is allowed to publish.
      const font = buildFont(composedExportDoc()!, trimmed);
      const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
      // The anon-key client is enough here: the signed token is the
      // authorisation, not the key. It grants exactly this one path, once.
      const { error: uploadError } = await createBrowserClient()
        .storage.from("fonts")
        .uploadToSignedUrl(start.path, start.token, blob, { contentType: "font/otf" });
      if (uploadError) {
        setPublishError("Upload failed — please try again.");
        return;
      }

      const finishRes = await fetch("/api/fonts/publish/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(meta),
      });
      const data = await finishRes.json();
      if (!finishRes.ok) {
        setPublishError(typeof data.error === "string" ? data.error : "Publish failed.");
        return;
      }
      trackExport("marketplace-publish");
      setPublishedSlug(data.slug);
    } catch {
      setPublishError("Network error — please try again.");
    } finally {
      setPublishing(false);
    }
  }

  function handleShareCopy(slug: string) {
    const url = `${window.location.origin}/marketplace/${slug}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setShareCopyState("copied");
        setShareCopiedSlug(slug);
      })
      .catch(() => {
        setShareCopyState("failed");
        setShareCopiedSlug(slug);
      });
    setTimeout(() => setShareCopyState("idle"), 1500);
  }

  function selectView(v: ViewDef) {
    setTopMode(v.topMode);
    if (v.drawStyle) setDrawStyle(v.drawStyle);
    setOpenMenu(null);
  }

  const visibleTools = TOOL_DEFS.filter((t) => (FREE_ONLY_TOOLS.has(t.value) ? drawStyle === "free" : true));

  // The toolbar row compacts visibleTools into slots, Illustrator-style: a
  // ToolGroup collapses into ONE slot at its first visible member's position,
  // holding the whole (visible) family for the flyout; ungrouped tools stay
  // one slot each. Derived from visibleTools, not TOOL_DEFS, so FREE_ONLY
  // filtering composes for free — Anchor outside Free simply drops out of
  // the editFamily flyout rather than needing its own special case.
  type ToolSlot = { kind: "single"; def: ToolDef } | { kind: "group"; group: ToolGroup; defs: ToolDef[] };
  const toolSlots: ToolSlot[] = [];
  {
    const defsByGroup = new Map<ToolGroup, ToolDef[]>();
    for (const t of visibleTools) {
      if (!t.group) {
        toolSlots.push({ kind: "single", def: t });
      } else if (defsByGroup.has(t.group)) {
        defsByGroup.get(t.group)!.push(t); // same array the slot already holds
      } else {
        const defs = [t];
        defsByGroup.set(t.group, defs);
        toolSlots.push({ kind: "group", group: t.group, defs });
      }
    }
  }

  return (
    <div className={styles.page}>
      <BetaBadge />

      <div className={styles.menuBar} data-chrome-menu>
        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("glypher")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={`${styles.menuTrigger} ${styles.appName}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "glypher"}
            onClick={() => setOpenMenu((m) => (m === "glypher" ? null : "glypher"))}
          >
            Fontane.Studio
          </button>
          {openMenu === "glypher" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setInfoModal("info"); setOpenMenu(null); }}
              >
                Info
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setInfoModal("howto"); setOpenMenu(null); }}
              >
                How to
              </button>
              <Link href="/features" role="menuitem" className={styles.dropdownItem} onClick={() => setOpenMenu(null)}>
                Features
              </Link>
              <a
                href="https://cnsl.aisu.studio/submit/fontane-cb43f90b"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => setOpenMenu(null)}
              >
                See &amp; Suggest Features
              </a>
              <Link href="/legal" role="menuitem" className={styles.dropdownItem} onClick={() => setOpenMenu(null)}>
                Imprint &amp; Privacy
              </Link>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("file")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => setOpenMenu((m) => (m === "file" ? null : "file"))}
          >
            File
          </button>
          {openMenu === "file" && (
            <div className={styles.dropdown} role="menu">
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { setConfirmNewFile(true); setOpenMenu(null); }}>
                New File
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleImportFffClick(); setOpenMenu(null); }}>
                <span>Import FFF</span>
                <span className={styles.dropdownItemHint}>Fontane Font File</span>
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleDownloadFff(); setOpenMenu(null); }}>
                <span>Export FFF</span>
                <span className={styles.dropdownItemHint}>Fontane Font File</span>
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleDownloadJson(); setOpenMenu(null); }}>
                Export JSON
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { handleExportOtf(); setOpenMenu(null); }}
              >
                Export OTF
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { handleExportSkeleton(); setOpenMenu(null); }}
              >
                Export Skeleton SVG
              </button>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("edit")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "edit"}
            onClick={() => setOpenMenu((m) => (m === "edit" ? null : "edit"))}
          >
            Edit
          </button>
          {openMenu === "edit" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={topMode !== "draw" || undoCount === 0}
                onClick={() => { handleUndo(); setOpenMenu(null); }}
              >
                Undo
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={topMode !== "draw" || redoCount === 0}
                onClick={() => { handleRedo(); setOpenMenu(null); }}
              >
                Redo
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleClear(); setOpenMenu(null); }}>
                Clear Artboard
              </button>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("view")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => setOpenMenu((m) => (m === "view" ? null : "view"))}
          >
            View
          </button>
          {openMenu === "view" && (
            <div className={styles.dropdown} role="menu">
              {VIEW_DEFS.map((v) => {
                const active = topMode === v.topMode && (!v.drawStyle || drawStyle === v.drawStyle);
                return (
                  <button
                    key={v.key}
                    type="button"
                    role="menuitem"
                    className={`${styles.dropdownItem} ${active ? styles.dropdownItemActive : ""}`}
                    onClick={() => selectView(v)}
                  >
                    {v.label}
                  </button>
                );
              })}
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={startTour}>
                Show tour again
              </button>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("tools")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "tools"}
            onClick={() => setOpenMenu((m) => (m === "tools" ? null : "tools"))}
          >
            Tools
          </button>
          {openMenu === "tools" && (
            <div className={styles.dropdown} role="menu">
              {visibleTools.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="menuitem"
                  className={`${styles.dropdownItem} ${drawTool === t.value ? styles.dropdownItemActive : ""}`}
                  onClick={() => { setDrawTool(t.value); setOpenMenu(null); }}
                >
                  {t.label} ({t.shortcut})
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("marketplace")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "marketplace"}
            onClick={() => setOpenMenu((m) => (m === "marketplace" ? null : "marketplace"))}
          >
            Marketplace
          </button>
          {openMenu === "marketplace" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { setMarketplaceModal("publish"); setOpenMenu(null); }}
              >
                Publish Font
              </button>
              <Link href="/marketplace" role="menuitem" className={styles.dropdownItem} onClick={() => setOpenMenu(null)}>
                Browse Fonts
              </Link>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setMarketplaceModal("share"); setOpenMenu(null); }}
              >
                Share Font
              </button>
            </div>
          )}
        </div>

        <div className={styles.menuItem}>
          <Link href="/features" className={styles.menuTrigger}>
            Features
          </Link>
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("cloud")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "cloud"}
            onClick={() => setOpenMenu((m) => (m === "cloud" ? null : "cloud"))}
          >
            Cloud
          </button>
          {openMenu === "cloud" && (
            <div className={styles.dropdown} role="menu">
              {!user ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.dropdownItem}
                  onClick={() => { setCloudModal("auth"); setAuthMode("login"); setCloudError(null); setOpenMenu(null); }}
                >
                  Sign In
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.dropdownItem}
                    disabled={glyphs.length === 0}
                    onClick={() => { openSaveToCloud(); setOpenMenu(null); }}
                  >
                    Save to Cloud
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.dropdownItem}
                    onClick={() => { openCloudProjects(); setOpenMenu(null); }}
                  >
                    My Cloud Projects
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.dropdownItem}
                    onClick={() => { handleLogOut(); setOpenMenu(null); }}
                  >
                    Log Out
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {topMode === "draw" && drawStyle === "grid" && (
          <div
            className={styles.menuItem}
            data-chrome-menu
            onMouseEnter={() => openMenuOnHover("charset")}
            onMouseLeave={scheduleMenuHoverClose}
          >
            <button
              type="button"
              className={styles.menuTrigger}
              aria-haspopup="menu"
              aria-expanded={openMenu === "charset"}
              onClick={() => setOpenMenu((m) => (m === "charset" ? null : "charset"))}
              data-tour="charsets"
            >
              Character Sets
            </button>
            {openMenu === "charset" && (
              <div className={styles.dropdown} role="menu">
                {/* Grouped by script, with the heading shown only where a
                    group actually needs naming — a lone "Latin" label above
                    the sets everyone already uses would be noise, but
                    "Hangul" above the Jamo set is the entire explanation of
                    what that one checkbox does. */}
                {SCRIPTS.map((script) => {
                  const sets = CHARACTER_SETS.filter((s) => scriptOf(s) === script.id);
                  if (sets.length === 0) return null;
                  return (
                    <div key={script.id}>
                      {script.id !== "latin" && <div className={styles.charsetGroupLabel}>{script.label}</div>}
                      {sets.map((set) => (
                        <label key={set.id} className={styles.charsetOption}>
                          <input
                            type="checkbox"
                            checked={activeSetIds.has(set.id)}
                            onChange={() => toggleCharacterSet(set.id)}
                          />
                          {set.label}
                        </label>
                      ))}
                    </div>
                  );
                })}

                {extraGridSlots.length > 0 && (
                  <div className={styles.extraGlyphList}>
                    {extraGridSlots.map((slot) => (
                      <div key={`${slot.kind}:${slot.name}`} className={styles.extraGlyphRow}>
                        <span>
                          {slot.name} <span className={styles.glyphMeta}>({slot.kind})</span>
                        </span>
                        <button
                          type="button"
                          className={styles.extraGlyphRemove}
                          onClick={() => removeGridSlot(slot.name, slot.kind)}
                          aria-label={`Remove ${slot.name}`}
                          title="Remove from Grid (keeps any strokes already drawn)"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* A ligature/alternate has nothing to lasso-select the way
                    Free's Assign panel does — Grid fuses capture+tagging per
                    cell, so this just appends an empty slot to draw into. */}
                <div className={styles.extraGlyphForm}>
                  {kindInput !== "alternate" && (
                    <input
                      type="text"
                      className={styles.nameInput}
                      placeholder={kindInput === "base" ? "character (e.g. a, é)" : "name (e.g. f_i.liga)"}
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGridSlot();
                        }
                      }}
                    />
                  )}
                  <div className={styles.modeToggle} role="radiogroup" aria-label="Glyph kind">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "base"}
                      className={`${styles.modeBtn} ${kindInput === "base" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("base")}
                    >
                      Base
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "ligature"}
                      className={`${styles.modeBtn} ${kindInput === "ligature" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("ligature")}
                    >
                      Ligature
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "alternate"}
                      className={`${styles.modeBtn} ${kindInput === "alternate" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("alternate")}
                      title="Alternate"
                    >
                      Alt
                    </button>
                  </div>
                  {kindInput === "ligature" && (
                    <input
                      type="text"
                      className={styles.nameInput}
                      placeholder="components (e.g. f, i)"
                      value={componentsInput}
                      onChange={(e) => setComponentsInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGridSlot();
                        }
                      }}
                    />
                  )}
                  {kindInput === "alternate" && (
                    <>
                      <input
                        type="text"
                        className={styles.nameInput}
                        placeholder="alternate of (e.g. a)"
                        value={alternateOfInput}
                        onChange={(e) => setAlternateOfInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddGridSlot();
                          }
                        }}
                      />
                      {alternateOfInput.trim() && (
                        <span className={styles.unicodeHint}>
                          {nextAlternateName(alternateOfInput.trim(), [...glyphs, ...extraGridSlots])}
                        </span>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={handleAddGridSlot}
                    disabled={kindInput === "alternate" ? !alternateOfInput.trim() : !nameInput.trim()}
                  >
                    Add Glyph
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.hBarGroup}>
          <button
            type="button"
            className={styles.hBarItem}
            onClick={handleUndo}
            disabled={topMode !== "draw" || undoCount === 0}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={16} strokeWidth={2} />
            <span>Undo</span>
          </button>
          <button
            type="button"
            className={styles.hBarItem}
            onClick={handleRedo}
            disabled={topMode !== "draw" || redoCount === 0}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={16} strokeWidth={2} />
            <span>Redo</span>
          </button>
        </div>
      </div>

      {topMode === "draw" && drawStyle !== "editor" && drawStyle !== "writer" && (
        <div className={styles.toolsViewsBar} data-chrome-menu data-tour="tools">
          <div className={styles.hBarGroup}>
            <span className={styles.hBarLabel}>Tools</span>
            {toolSlots.map((slot) => {
              if (slot.kind === "single") {
                const t = slot.def;
                return (
                  <button
                    key={t.value}
                    type="button"
                    className={`${styles.hBarItem} ${drawTool === t.value ? styles.hBarItemActive : ""}`}
                    onClick={() => setDrawTool(t.value)}
                    aria-label={`${t.label} (${t.shortcut})`}
                    title={`${t.label} (${t.shortcut})`}
                  >
                    <t.icon size={16} strokeWidth={2} />
                    <span>{t.label}</span>
                  </button>
                );
              }
              // Illustrator-style grouped slot: the button wears the
              // last-used member's face (activeByGroup), falling back to the
              // group's headline tool when the remembered one is filtered out
              // of this view (Anchor in Grid) — the fallback also keeps the
              // click handler from re-activating a tool with no button here.
              // hBarItemActive tracks the LIVE drawTool, not the remembered
              // face: the slot only lights up while one of its members is
              // actually the current tool.
              const face = slot.defs.find((t) => t.value === activeByGroup[slot.group]) ?? slot.defs[0];
              const flyoutKey: MenuKey = `flyout-${slot.group}`;
              return (
                <div
                  key={slot.group}
                  className={styles.toolSlot}
                  onMouseEnter={() => scheduleFlyoutHoverOpen(flyoutKey)}
                  onMouseLeave={() => {
                    cancelFlyoutHoverOpen();
                    scheduleMenuHoverClose();
                  }}
                >
                  <button
                    type="button"
                    className={`${styles.hBarItem} ${styles.toolSlotCorner} ${slot.defs.some((t) => t.value === drawTool) ? styles.hBarItemActive : ""}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === flyoutKey}
                    aria-label={`${face.label} (${face.shortcut})`}
                    title={`${face.label} (${face.shortcut}) — hold for more tools`}
                    onPointerDown={() => armFlyoutLongPress(flyoutKey)}
                    onPointerUp={cancelFlyoutLongPress}
                    onPointerLeave={cancelFlyoutLongPress}
                    onClick={() => {
                      // A completed long-press already opened the flyout —
                      // the click that fires on release must not ALSO
                      // activate (armFlyoutLongPress resets the flag on the
                      // next press, so a swallowed click can't go stale).
                      if (flyoutLongPressFiredRef.current) {
                        flyoutLongPressFiredRef.current = false;
                        return;
                      }
                      setDrawTool(face.value);
                    }}
                  >
                    <face.icon size={16} strokeWidth={2} />
                    <span>{face.label}</span>
                  </button>
                  {openMenu === flyoutKey && (
                    <div className={styles.dropdown} role="menu">
                      {slot.defs.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          role="menuitem"
                          className={`${styles.dropdownItem} ${styles.flyoutItem} ${drawTool === t.value ? styles.dropdownItemActive : ""}`}
                          onClick={() => {
                            setDrawTool(t.value);
                            setOpenMenu(null);
                          }}
                        >
                          <t.icon size={14} strokeWidth={2} />
                          <span>
                            {t.label} ({t.shortcut})
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <input
        ref={fffInputRef}
        type="file"
        accept=".fff,application/json"
        onChange={handleImportFffChange}
        style={{ display: "none" }}
      />

      <input
        ref={traceInputRef}
        type="file"
        accept={TRACE_ACCEPT}
        onChange={handleTraceImageChange}
        style={{ display: "none" }}
      />

      <div className={styles.body}>
        <main className={styles.main}>

      {topMode === "draw" && (
        <div className={styles.viewTabs} role="tablist" aria-label="View" data-tour="view-tabs">
          {VIEW_DEFS.map((v) => {
            const active = topMode === v.topMode && (!v.drawStyle || drawStyle === v.drawStyle);
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.viewTab} ${active ? styles.viewTabActive : ""}`}
                onClick={() => selectView(v)}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Script tabs appear only once a second script is switched on. With
          Latin alone there is nothing to switch between, so a Latin-only
          user never meets the concept — the same reason the Grid stopped
          gating on a setup overlay. */}
      {topMode === "draw" && drawStyle === "grid" && gridScripts.length > 1 && (
        <div className={styles.scriptTabs} role="tablist" aria-label="Script">
          {gridScripts.map((id) => {
            const script = scriptById(id);
            const active = id === activeScript;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.scriptTab} ${active ? styles.scriptTabActive : ""}`}
                onClick={() => setActiveScript(id)}
              >
                {script.label}
              </button>
            );
          })}
          {activeScript === "hangul" && (
            <span className={styles.scriptTabNote}>
              {jamoDrawn} / {BASIC_JAMO.length} jamo · {variantsDrawn} / {allVariantSlots().length} variants ·{" "}
              {hangulCoverage.covered.toLocaleString("en-US")} of {hangulCoverage.total.toLocaleString("en-US")}{" "}
              syllables
            </span>
          )}
        </div>
      )}

      {topMode === "draw" && drawStyle === "free" && drawTool === "assign" && glyphs.length > 0 && (
        <div className={styles.glyphListWrap}>
          <div className={styles.glyphListHeader}>
            <span>{glyphs.length} tagged</span>
            <button
              type="button"
              className={styles.glyphListToggle}
              onClick={() => setGlyphListExpanded((v) => !v)}
            >
              {glyphListExpanded ? "Collapse" : "Show all"}
            </button>
          </div>
          <ul className={`${styles.glyphList} ${glyphListExpanded ? "" : styles.glyphListCollapsed}`}>
            {glyphs.map((g) => (
              <li key={g.id} className={styles.glyphItem}>
                <span className={styles.glyphName}>{g.name}</span>
                <span className={styles.glyphMeta}>
                  {g.kind === "base" && (g.unicode ?? "no unicode")}
                  {g.kind === "ligature" && `ligature: ${g.components?.join(" + ") || "—"}`}
                  {g.kind === "alternate" && `alt of ${g.alternateOf || "—"}`}
                </span>
                <span className={styles.glyphCount}>{g.strokeIds.length} strokes</span>
                <button type="button" className={styles.untagBtn} onClick={() => handleUntag(g.id)}>
                  untag
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={styles.canvasWrap}
        style={!(topMode === "draw" && drawStyle === "free") ? { display: "none" } : undefined}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
        {topMode === "draw" && drawStyle === "free" && !freeDrawIntroDismissed && (
          <div className={styles.introOverlay}>
            <div className={styles.introCard}>
              <h2 className={styles.introTitle}>The Sketcher</h2>
              <p className={styles.introText}>
                Here you can write freely, select and assign singly letters, numbers or other glyphs. You can also
                assign ligatures and alternate letters.
              </p>
              <h3 className={styles.introSubtitle}>How it works</h3>
              <div className={styles.introSteps}>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <Pencil size={16} strokeWidth={2} />
                    Draw
                  </span>
                  <p className={styles.introStepText}>Create your letter shapes</p>
                </div>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <Lasso size={16} strokeWidth={2} />
                    Select
                  </span>
                  <p className={styles.introStepText}>Select a letter, glyph or ligature</p>
                </div>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <BookA size={16} strokeWidth={2} />
                    Assign
                  </span>
                  <p className={styles.introStepText}>Assign to the respective glyph class</p>
                </div>
              </div>
              <p className={styles.introText}>
                You can then adjust the geometry or side bearings in the grid view or test them in the editor view
              </p>
              <div className={styles.introActions}>
                <button type="button" className={styles.clearBtn} onClick={dismissFreeDrawIntro}>
                  Start
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {topMode === "draw" && drawStyle === "grid" && (
        <div className={styles.gridWrap} data-tour="grid">
          {/* One page per step instead of 94 cells in one scroll. Every chip
              stays clickable: the recommended order (syllables first, because
              that is where the weight comes from) and the required one (the 24
              jamo, which are what covers all 11.172 syllables) genuinely
              differ, and a lock would make the tool lie about which of the two
              it is enforcing. The arrow says where the flow points; it doesn't
              say where you may go. */}
          {gridSteps.length > 0 && (
            <div className={styles.gridSteps} role="tablist" aria-label="Steps">
              {gridSteps.map((step, i) => {
                const active = step.id === activeStep?.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-current={active ? "step" : undefined}
                    className={`${styles.gridStep} ${active ? styles.gridStepActive : ""}`}
                    onClick={() => setGridStep(step.id)}
                  >
                    <span className={styles.gridStepIndex}>{i + 1}</span>
                    <span className={styles.gridJumpExample}>{step.example}</span>
                    <span className={styles.gridStepLabel}>{step.label}</span>
                    <span className={styles.gridStepMeta}>
                      {step.done === step.total && step.total > 0 ? "✓ " : ""}
                      {step.done} / {step.total}
                    </span>
                    {step.id === recommendedStep && !active && <span className={styles.gridStepNext}>next</span>}
                  </button>
                );
              })}
            </div>
          )}
          {activeStep && (
            <p className={styles.gridStepGoal}>
              {activeStep.goal}
              {activeStep.id === "step-syllables" && penFit && (
                <>
                  {" "}
                  <span className={styles.gridStepFit}>
                    Your pen is {Math.round(penFit.fraction * 1000) / 10}% of the em — it carries{" "}
                    {penFit.carries.length > 0 ? penFit.carries.join(" ") : "no batchim"} at the foot
                    {penFit.tooFatFor.length > 0
                      ? `, but not ${penFit.tooFatFor.join(" ")} — the tightest of those, ${penFit.tightest}, needs ${
                          Math.round(penFit.tightestLimit * 1000) / 10
                        }%.`
                      : "."}
                  </span>
                </>
              )}
            </p>
          )}
          {/* The action belongs where the flow is, not only in the settings
              panel: someone standing in front of 14 empty batchim cells is
              exactly the person who needs to be told they fill themselves. */}
          {activeStep?.id === "step-variants" && activeScript === "hangul" && (
            <div className={styles.gridStepAction}>
              {harvestable.length > 0 ? (
                <button type="button" className={styles.clearBtn} onClick={harvestBatchim}>
                  Harvest {harvestable.length} batchim from your syllables
                </button>
              ) : (
                <span className={styles.gridStepGoal}>
                  These fill themselves once you have drawn syllables in step 1 — they are not meant to be drawn by
                  hand, which is why the band is so shallow.
                </span>
              )}
            </div>
          )}
          {/* The end of the path, said once and where it happens. The counters
              say 24 / 24; they don't say "and that is the whole writing
              system, you can stop now". */}
          {activeStep?.id === "step-jamo" && activeScript === "hangul" && jamoDrawn === BASIC_JAMO.length && (
            <p className={styles.gridStepGoal}>
              <span className={styles.gridStepFit}>
                Complete — all {hangulCoverage.total.toLocaleString("en-US")} syllables are covered. File &rsaquo;
                Export, or
                try it in Typer first.
              </span>
            </p>
          )}
          {/* The jump row survives, but only where it still has a job: two of
              the three steps hold a single group, and one destination is not a
              navigation. */}
          {activeStep && activeStep.groupIds.length > 1 && (
            <div className={styles.gridJumps}>
              {/* Underlined text alone was read as four labels, not four
                  destinations — the row needs to say what it is before the
                  words in it mean anything. */}
              <span className={styles.gridJumpsLabel}>Jump to</span>
              {gridGroups
                .filter((g) => activeStep.groupIds.includes(g.id))
                .map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={styles.gridJump}
                    onClick={() => scrollGroupIntoView(g.id)}
                  >
                    <span className={styles.gridJumpExample}>{g.example}</span>
                    {g.label}
                  </button>
                ))}
            </div>
          )}
          <div className={styles.grid} ref={gridScrollRef}>
            {visibleGridSlots.map((slot) => {
              const { name, kind } = slot;
              const cellKey = `${kind}:${name}`;
              // A full-width heading before the first cell of each group. In a
              // flex-wrap grid a 100%-wide item is also the line break, so the
              // groups start on their own row without a second container.
              const heading = gridHeadingFor(name);
              const glyph = glyphs.find((g) => g.kind === kind && g.name === name);
              const glyphStrokes = glyph
                ? glyph.strokeIds
                    .map((id) => completedRef.current.find((s) => s.id === id))
                    .filter((s): s is Stroke => Boolean(s))
                : [];
              const needsFit = glyph && !(glyph.cellWidth && glyph.cellHeight);
              const slotSize = cellSizeForSlot(name, activeScript, cellSize, glyph?.widthRatio ?? cellWidthRatio);
              const cellHeightPx = slotSize.height;
              // A glyph's own widthRatio (dragged per-cell — see the width
              // handle in GridCell) overrides the global Width slider just
              // for this cell; everything else still follows cellWidthRatio.
              const effectiveWidthPx = slotSize.width;
              // The canvas's own measured size (once GridCell has reported
              // in) — not the nominal effectiveWidthPx/cellHeightPx, which the
              // label bar underneath already eats a few px of. Using the
              // nominal value here made a freshly-drawn stroke's anchor not
              // quite match what fromAnchorSpace later rescales against, so it
              // visibly jumped a few pixels the instant the stroke committed.
              const liveWidth = cellDims[cellKey]?.width ?? effectiveWidthPx;
              const liveHeight = cellDims[cellKey]?.height ?? cellHeightPx;
              // The geometric scale this fit/rescale applies to point
              // positions has to also apply to stroke width — otherwise a
              // Free-tagged glyph (always a dramatic scale-down, from a
              // large Free-canvas bbox to a small cell) renders with its
              // original Free-canvas ink weight, wildly too thick for the
              // shrunk letterforms.
              const fitScale = needsFit
                ? fitStrokesToCell(glyphStrokes, name, liveWidth, liveHeight, metrics)
                : {
                    points: glyphStrokes.map((s) =>
                      fromAnchorSpace(s.points, glyph?.cellWidth, glyph?.cellHeight, liveWidth, liveHeight, keepProportions)
                    ),
                    scale: anchorSpaceWidthScale(glyph?.cellWidth, glyph?.cellHeight, liveWidth, liveHeight, keepProportions),
                  };
              const fittedPoints = fitScale.points;
              const cellStrokes = glyphStrokes.map((s, i) => ({
                id: s.id,
                points: fittedPoints[i],
                widthScale: (s.widthScale ?? 1) * fitScale.scale,
                // Carried through so the cell can rebuild the SAME outline the
                // stroke was drawn with — a calligraphy stroke re-rendered as
                // a pen one comes back with round ends instead of the nib's
                // flat cuts, and stops matching what Free/Editor show for the
                // very same glyph.
                kind: s.kind,
              }));
              // This glyph's Vector shapes, rescaled into the cell's live
              // pixel space the same way its strokes are above. There's no
              // fitStrokesToCell equivalent for the needsFit case on purpose:
              // that bbox fit is derived from the glyph's STROKES, and a
              // Free-assigned glyph's shapes would have to ride along on
              // exactly the same transform to stay aligned with them — until
              // fitStrokesToCell reports its offsets too, they simply stay in
              // whatever space they were assigned in.
              const cellVectorShapes = (glyph?.vectorShapeIds ?? []).flatMap((id) => {
                const shape = vectorShapesRef.current.find((s) => s.id === id);
                return shape
                  ? [
                      vectorShapeAcrossAnchorSpace(
                        shape,
                        glyph?.cellWidth,
                        glyph?.cellHeight,
                        liveWidth,
                        liveHeight,
                        keepProportions
                      ),
                    ]
                  : [];
              });
              const cell = (
                <GridCell
                  key={cellKey}
                  label={name}
                  strokes={cellStrokes}
                  tool={(FREE_ONLY_TOOLS.has(drawTool) ? "pen" : drawTool) as CellTool}
                  onErase={(ids) => deleteStrokes(ids)}
                  onStrokesChange={(updates) => handleGridStrokesChange(slot, updates, liveWidth, liveHeight)}
                  strokeOptions={optionsFor(settings)}
                  nib={nibFor(settings)}
                  vectorRenderMode={settings.vectorRenderMode}
                  vectorStrokeWidth={settings.vectorStrokeWidth}
                  onStrokeComplete={(stroke, reportedWidth, reportedHeight, durationMs) =>
                    handleGridStroke(slot, stroke, reportedWidth, reportedHeight, durationMs)
                  }
                  vectorShapes={cellVectorShapes}
                  onVectorShapesChange={(shapes) => handleGridVectorShapes(slot, shapes, liveWidth, liveHeight)}
                  // Feeds the palette's Path section, tagging the cell's
                  // label as the source. A cell's session-END (null) only
                  // clears the panel if the panel was showing THAT cell —
                  // sessions are per-cell and several can be open at once,
                  // so cell A ending must not blank cell B's fresh report.
                  onVectorSessionChange={(info) =>
                    setVectorPanelInfo((prev) =>
                      info ? { source: name, ...info } : prev && prev.source === name ? null : prev
                    )
                  }
                  metrics={metrics}
                  leftBearing={glyph?.leftBearing}
                  rightBearing={glyph?.rightBearing}
                  onBearingsChange={(left, right) => handleBearingsChange(slot, left, right)}
                  lockBearings={lockBearings}
                  guides={scriptById(activeScript).guides}
                  referenceChar={allVariantSlots().find((v) => v.name === name)?.base}
                  showReferenceGlyph={showReferenceGlyph}
                  onResize={(width, height) => handleCellResize(cellKey, width, height)}
                  widthPx={effectiveWidthPx}
                  heightPx={cellHeightPx}
                  onWidthCommit={glyph ? (newWidthPx) => handleGlyphWidthChange(slot, newWidthPx) : undefined}
                  onWidthReset={() => handleGlyphWidthReset(slot)}
                  firstStepHint={cellKey === firstStepCellKey ? "Draw your first letter here" : undefined}
                  note={jamoWeightNotes.get(name)}
                />
              );

              return heading ? (
                <Fragment key={`sec:${cellKey}`}>
                  <h3 id={heading.id} className={styles.gridSectionHeading}>
                    <span className={styles.gridJumpExample}>{heading.example}</span>
                    {heading.label} <span className={styles.gridSectionCount}>({heading.count})</span>
                  </h3>
                  {cell}
                </Fragment>
              ) : (
                cell
              );
            })}
          </div>
          {/* No more hard gate here before you can draw — Latin Basic is
              already the active default, and the exact same picker lives in
              the Character Sets menu for anyone who wants Cyrillic/Greek/
              etc. from the start. Blocking every empty project behind a
              full-screen "pick your charsets" modal was pure first-impression
              friction with no upside the menu doesn't already cover. */}
        </div>
      )}

      {topMode === "draw" && drawStyle === "editor" && (
        <EditorPanel
          glyphs={glyphs}
          strokes={completedRef.current}
          vectorShapes={vectorShapesRef.current}
          metrics={metrics}
          settings={settings}
          text={editorText}
          onTextChange={updateEditorText}
          fontSize={editorFontSize}
          useLigatures={useLigatures}
        />
      )}

      {topMode === "draw" && drawStyle === "writer" && <Writer />}

      {topMode === "animate" && (
        <AnimatePanel
          glyphs={glyphs}
          strokes={completedRef.current}
          metrics={metrics}
          text={animateText}
          onTextChange={setAnimateText}
          presetId={animatePresetId}
          onPresetChange={setAnimatePresetId}
        />
      )}
        </main>

        <aside
          className={`${styles.settingsPanel} ${!displaySettingsPanelOpen ? styles.settingsPanelCollapsed : ""}`}
          data-chrome-menu
        >
          {/* Whole-panel collapse (separate from each SettingsSection's own
              open/closed state) — a pure CSS class toggle, content stays
              mounted (display:none). Renders off displaySettingsPanelOpen,
              not settingsPanelOpen directly — see panelReady above. */}
          <button
            type="button"
            className={styles.settingsPanelToggle}
            onClick={toggleSettingsPanel}
            aria-expanded={displaySettingsPanelOpen}
            title={displaySettingsPanelOpen ? "Collapse settings panel" : "Expand settings panel"}
          >
            {displaySettingsPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <div className={styles.settingsPanelBody} aria-hidden={!displaySettingsPanelOpen}>
          <div className={styles.settingsPanelLabel}>Settings</div>
          {/* Glyphs' Info box, as a palette section: while a pen-family tool
              is active, the current path's vitals live here — fed by the
              Free canvas's own session refs (syncVectorPanelInfo) or by
              whichever Grid cell last reported via onVectorSessionChange. */}
          {topMode === "draw" && VECTOR_TOOLS.has(drawTool) && (
            <SettingsSection id="anchorInfo" title="Path" defaultOpen>
              {/* Draw-time default for the NEXT path started, baked onto it
                  at its first anchor (see handleVectorPointerDown) — same
                  "picked before you draw, not edited after" relationship the
                  rest of this panel's controls already have to a stroke.
                  Shown regardless of whether a path is currently selected. */}
              <div className={styles.sliders}>
                <div className={styles.settingsSubLabel}>New path</div>
                <div className={styles.modeToggle} role="radiogroup" aria-label="Fill or stroke">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={settings.vectorRenderMode === "fill"}
                    className={`${styles.modeBtn} ${settings.vectorRenderMode === "fill" ? styles.modeBtnActive : ""}`}
                    onClick={() => updateSetting("vectorRenderMode", "fill")}
                  >
                    Fill
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={settings.vectorRenderMode === "stroke"}
                    className={`${styles.modeBtn} ${settings.vectorRenderMode === "stroke" ? styles.modeBtnActive : ""}`}
                    onClick={() => updateSetting("vectorRenderMode", "stroke")}
                  >
                    Stroke
                  </button>
                </div>
                {settings.vectorRenderMode === "stroke" && (
                  <label className={styles.sliderRow}>
                    <span>Width</span>
                    <input
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={settings.vectorStrokeWidth}
                      onChange={(e) => updateSetting("vectorStrokeWidth", Number(e.target.value))}
                    />
                    <span className={styles.val}>{settings.vectorStrokeWidth}</span>
                  </label>
                )}
              </div>
              {vectorPanelInfo ? (
                <>
                  <div className={styles.sliders}>
                    <div className={styles.sliderRow}>
                      <span>Source</span>
                      <span className={styles.val}>{vectorPanelInfo.source}</span>
                    </div>
                    <div className={styles.sliderRow}>
                      <span>Anchors</span>
                      <span className={styles.val}>{vectorPanelInfo.anchorCount}</span>
                    </div>
                    <div className={styles.sliderRow}>
                      <span>Closed</span>
                      <span className={styles.val}>{vectorPanelInfo.closed ? "yes" : "no"}</span>
                    </div>
                    <div className={styles.sliderRow}>
                      <span>Smooth</span>
                      <span className={styles.val}>
                        {vectorPanelInfo.smoothCount}/{vectorPanelInfo.anchorCount}
                      </span>
                    </div>
                  </div>
                  {vectorPanelInfo.source === "Free" ? (
                    <button type="button" className={styles.clearBtn} onClick={handleToggleSmoothClick}>
                      Toggle smooth
                    </button>
                  ) : (
                    // Grid sessions live in cell-local space the page can't
                    // reach into — the cells' own dblclick toggle covers it.
                    <span className={styles.unicodeHint}>Double-click an anchor to toggle smooth/corner</span>
                  )}
                </>
              ) : (
                <span className={styles.unicodeHint}>Click or draw a path</span>
              )}
            </SettingsSection>
          )}
          {topMode === "draw" && drawStyle === "free" && drawTool === "assign" && (
            <>
              {kindInput !== "alternate" && (
                <input
                  type="text"
                  className={styles.contextField}
                  placeholder={kindInput === "base" ? "character (e.g. a, é)" : "name (e.g. f_i.liga)"}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={handleAssignKeyDown}
                />
              )}
              <div className={styles.modeToggle} role="radiogroup" aria-label="Glyph kind">
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "base"}
                  className={`${styles.modeBtn} ${kindInput === "base" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("base")}
                >
                  Base
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "ligature"}
                  className={`${styles.modeBtn} ${kindInput === "ligature" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("ligature")}
                >
                  Ligature
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "alternate"}
                  className={`${styles.modeBtn} ${kindInput === "alternate" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("alternate")}
                  title="Alternate"
                >
                  Alt
                </button>
              </div>

              {kindInput === "base" && nameInput.trim() && (
                <span className={styles.unicodeHint}>{unicodeFor(nameInput.trim()) ?? "not a single character"}</span>
              )}
              {kindInput === "ligature" && (
                <input
                  type="text"
                  className={styles.nameInput}
                  placeholder="components (e.g. f, i)"
                  value={componentsInput}
                  onChange={(e) => setComponentsInput(e.target.value)}
                  onKeyDown={handleAssignKeyDown}
                />
              )}
              {kindInput === "alternate" && (
                <>
                  <input
                    type="text"
                    className={styles.nameInput}
                    placeholder="alternate of (e.g. a)"
                    value={alternateOfInput}
                    onChange={(e) => setAlternateOfInput(e.target.value)}
                    onKeyDown={handleAssignKeyDown}
                  />
                  {alternateOfInput.trim() && (
                    <span className={styles.unicodeHint}>{nextAlternateName(alternateOfInput.trim(), glyphs)}</span>
                  )}
                </>
              )}

              <button
                type="button"
                className={styles.clearBtn}
                onClick={handleAssign}
                disabled={(kindInput === "alternate" ? !alternateOfInput.trim() : !nameInput.trim()) || selectedIds.length === 0}
              >
                Assign ({selectedIds.length})
              </button>
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
              >
                Deselect
              </button>
            </>
          )}
          {topMode === "draw" && drawStyle === "grid" && (
            <>
              <SettingsSection id="cellLayout" title="Cell" defaultOpen tourId="cell-settings">
              <div className={styles.sliders}>
                {/* The label stays the same string in both states on purpose:
                    lockBearings is read from localStorage during the first render
                    (so the Grid is already locked on the very first frame, not a
                    frame later), which means the server rendered this button
                    from the default. Swapping the TEXT on it made that a
                    hydration mismatch React can't patch up quietly — a real
                    #418 in the console on every locked reload. The on state
                    rides on the class and aria-pressed instead, attributes React
                    reconciles without complaint, and the filled treatment is the
                    same one the Base/Ligature/Alt toggle already uses for
                    "this one is active". */}
                <button
                  type="button"
                  aria-pressed={lockBearings}
                  className={`${styles.clearBtn} ${lockBearings ? styles.toggleBtnOn : ""}`}
                  onClick={() => updateLockBearings(!lockBearings)}
                  title={
                    lockBearings
                      ? "Bearings are locked — the bearing lines and the cell width handle ignore the pointer, so you can draw straight over them"
                      : "Lock the bearing lines and the cell width handle so drawing over them doesn't drag them"
                  }
                >
                  Lock Bearings
                </button>
                <label className={styles.sliderRow}>
                  <span>Zoom</span>
                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.025}
                    value={zoom}
                    onChange={(e) => updateZoom(Number(e.target.value))}
                  />
                  <span className={styles.val}>{Math.round(zoom * 100)}%</span>
                </label>
                {/* Only offered once it can actually have happened: letters
                    drawn at two different cell sizes carry two different
                    stroke weights, and nothing else in the UI admits that. */}
                {mixedDrawWeights && (
                  <>
                    <p className={styles.settingsNote}>
                      Some letters were drawn at a different cell size, so they carry a heavier or lighter stroke than
                      the rest. Geometry stays as drawn.
                    </p>
                    <button type="button" className={styles.clearBtn} onClick={evenOutStrokeWeights}>
                      Even out stroke weights
                    </button>
                  </>
                )}
                <label className={styles.sliderRow}>
                  <span>Width</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={cellWidthRatio}
                    onChange={(e) => updateCellWidthRatio(Number(e.target.value))}
                  />
                  <span className={styles.val}>{cellWidthRatio.toFixed(2)}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>
                    <input
                      type="checkbox"
                      checked={keepProportions}
                      onChange={(e) => updateKeepProportions(e.target.checked)}
                    />{" "}
                    Keep Proportions
                  </span>
                </label>
                <label className={styles.sliderRow}>
                  <span>
                    <input
                      type="checkbox"
                      checked={showReferenceGlyph}
                      onChange={(e) => updateShowReferenceGlyph(e.target.checked)}
                    />{" "}
                    Reference Letterform
                  </span>
                </label>
              </div>
              </SettingsSection>
            </>
          )}
          {topMode === "draw" && drawStyle === "free" && (
            <SettingsSection id="freeCanvas" title="Canvas" defaultOpen>
              <div className={styles.sliders}>
                <label className={styles.sliderRow}>
                  <span>Line spacing</span>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    step={5}
                    value={lineSpacing}
                    onChange={(e) => updateLineSpacing(Number(e.target.value))}
                  />
                  <span className={styles.val}>{lineSpacing}</span>
                </label>
                {traceImageInfo && (
                  <>
                    <label className={styles.sliderRow}>
                      <span>Trace opacity</span>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={traceOpacity}
                        onChange={(e) => updateTraceOpacity(Number(e.target.value))}
                      />
                      <span className={styles.val}>{traceOpacity}%</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Trace scale</span>
                      <input
                        type="range"
                        min={5}
                        max={400}
                        step={5}
                        value={traceScale}
                        onChange={(e) => updateTraceScale(Number(e.target.value))}
                      />
                      <span className={styles.val}>{traceScale}%</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Trace X</span>
                      <input
                        type="range"
                        min={-1000}
                        max={1000}
                        step={5}
                        value={traceOffset.x}
                        onChange={(e) => updateTraceOffset("x", Number(e.target.value))}
                      />
                      <span className={styles.val}>{traceOffset.x}</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Trace Y</span>
                      <input
                        type="range"
                        min={-1000}
                        max={1000}
                        step={5}
                        value={traceOffset.y}
                        onChange={(e) => updateTraceOffset("y", Number(e.target.value))}
                      />
                      <span className={styles.val}>{traceOffset.y}</span>
                    </label>
                  </>
                )}
                <button type="button" className={styles.clearBtn} onClick={handleTraceImportClick}>
                  {traceImageInfo ? "Replace trace image" : "Import trace image"}
                </button>
                {traceImageInfo && (
                  <button type="button" className={styles.clearBtn} onClick={removeTraceImage}>
                    Remove trace image
                  </button>
                )}
              </div>
            </SettingsSection>
          )}
          {topMode === "draw" && drawStyle === "free" && selectedIds.length > 0 && (
            <div className={styles.sliders}>
              <label className={styles.sliderRow}>
                <span>Skew horizontal</span>
                <input
                  type="range"
                  min={-75}
                  max={75}
                  step={1}
                  value={skewH}
                  onChange={(e) => updateSkewH(Number(e.target.value))}
                />
                <span className={styles.val}>{skewH}°</span>
              </label>
              <label className={styles.sliderRow}>
                <span>Skew vertical</span>
                <input
                  type="range"
                  min={-75}
                  max={75}
                  step={1}
                  value={skewV}
                  onChange={(e) => updateSkewV(Number(e.target.value))}
                />
                <span className={styles.val}>{skewV}°</span>
              </label>
            </div>
          )}

          {topMode === "draw" && drawStyle === "editor" && (
            <>
              <SettingsSection id="text" title="Text" defaultOpen>
              <div className={styles.sliders}>
                <label className={styles.sliderRow}>
                  <span>Size</span>
                  <input
                    type="range"
                    min={12}
                    max={300}
                    step={1}
                    value={editorFontSize}
                    onChange={(e) => updateEditorFontSize(Number(e.target.value))}
                  />
                  <span className={styles.val}>{editorFontSize}pt</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>
                    <input
                      type="checkbox"
                      checked={useLigatures}
                      onChange={(e) => updateUseLigatures(e.target.checked)}
                    />{" "}
                    Ligatures
                  </span>
                </label>
              </div>
              </SettingsSection>
              {missingEditorGlyphs.length > 0 && (
                <div className={styles.animateWarning}>missing glyphs: {missingEditorGlyphs.join(" ")}</div>
              )}
            </>
          )}

          {/* The nib replaces the pen's own controls rather than sitting
              below them: none of Mono/Dynamic, Thinning, Smoothing or
              Streamline mean anything to a broad nib (it ignores pressure by
              design — width comes from the direction you move), and Size
              would read as one shared control while actually being two. The
              Brush toggle stays out too: a calligraphy stroke never goes
              through an applicator (see outlineFor). Collapsed by default —
              first thing a new user sees shouldn't be a wall of font-brush
              jargon before their first stroke; the toggle still remembers
              itself once opened, same as Metrics. */}
          {showStrokeControls && drawTool === "calligraphy" && (
            <SettingsSection id="stroke" title="Stroke" defaultOpen={false} tourId="stroke">
              <div className={styles.sliders}>
                <NibPreview nib={nibFor(settings)} />
                <label className={styles.sliderRow}>
                  <span>Nib size</span>
                  <input
                    type="range"
                    min={4}
                    max={60}
                    step={1}
                    value={settings.nibSize}
                    onChange={(e) => updateSetting("nibSize", Number(e.target.value))}
                  />
                  <span className={styles.val}>{settings.nibSize}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>Oval</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={settings.nibRatio}
                    onChange={(e) => updateSetting("nibRatio", Number(e.target.value))}
                  />
                  <span className={styles.val}>{settings.nibRatio.toFixed(2)}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>Angle</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={settings.nibAngle}
                    onChange={(e) => updateSetting("nibAngle", Number(e.target.value))}
                  />
                  <span className={styles.val}>{settings.nibAngle}°</span>
                </label>
              </div>
            </SettingsSection>
          )}

          {/* Stroke sliders only while a stroke-family tool is active (see
              STROKE_TOOLS) — with a vector or transform tool up they'd
              promise an effect the tool can't deliver. Collapsed by default,
              same reasoning as the calligraphy variant above. */}
          {showStrokeControls && STROKE_TOOLS.has(drawTool) && drawTool !== "calligraphy" && (
            <SettingsSection id="stroke" title="Stroke" defaultOpen={false} tourId="stroke">
              <div className={styles.sliders}>
                <StrokePreview settings={settings} />
                {/* Which applicator turns the skeleton into ink. Everything
                    below this toggle is that brush's own parameter set — the
                    three have almost nothing in common beyond Size, so showing
                    all of them at once would be mostly disabled controls. */}
                <div className={styles.settingsSubLabel}>Brush</div>
                <div className={styles.modeToggle} role="radiogroup" aria-label="Brush">
                  {BRUSH_DEFS.map((b) => (
                    <button
                      key={b.kind}
                      type="button"
                      role="radio"
                      aria-checked={settings.brush.kind === b.kind}
                      title={b.hint}
                      className={`${styles.modeBtn} ${settings.brush.kind === b.kind ? styles.modeBtnActive : ""}`}
                      onClick={() => updateBrushKind(b.kind)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {/* Mono/Dynamic is a freehand-only distinction: it zeroes
                    perfect-freehand's thinning, which the other two brushes
                    never consult (they have their own Pressure amount). */}
                {settings.brush.kind === "freehand" && (
                  <div className={styles.modeToggle} role="radiogroup" aria-label="Stroke mode">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={settings.mode === "mono"}
                      className={`${styles.modeBtn} ${settings.mode === "mono" ? styles.modeBtnActive : ""}`}
                      onClick={() => updateSetting("mode", "mono")}
                    >
                      Mono line
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={settings.mode === "dynamic"}
                      className={`${styles.modeBtn} ${settings.mode === "dynamic" ? styles.modeBtnActive : ""}`}
                      onClick={() => updateSetting("mode", "dynamic")}
                    >
                      Dynamic
                    </button>
                  </div>
                )}

                {/* Size is the one setting every brush shares — pen width for
                    freehand, nib length for the nib, and the unit every
                    scatter length is a multiple of. It stays put across brush
                    switches so the toggle doesn't move the controls under the
                    pointer. */}
                <label className={styles.sliderRow}>
                  <span>Size</span>
                  <input
                    type="range"
                    min={4}
                    max={60}
                    step={1}
                    value={settings.size}
                    onChange={(e) => updateSetting("size", Number(e.target.value))}
                  />
                  <span className={styles.val}>{settings.size}</span>
                </label>

                {settings.brush.kind === "freehand" && settings.mode === "dynamic" && (
                  <>
                    <label className={styles.sliderRow}>
                      <span>Thinning</span>
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={settings.thinning}
                        onChange={(e) => updateSetting("thinning", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.thinning.toFixed(2)}</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Smoothing</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.smoothing}
                        onChange={(e) => updateSetting("smoothing", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.smoothing.toFixed(2)}</span>
                    </label>
                  </>
                )}

                {settings.brush.kind === "nib" && (
                  <>
                    <label className={styles.sliderRow}>
                      <span>Nib angle</span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={settings.brush.nib.angle}
                        onChange={(e) => updateNib("angle", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.nib.angle}°</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Flatness</span>
                      <input
                        type="range"
                        min={0.02}
                        max={1}
                        step={0.02}
                        value={settings.brush.nib.ratio}
                        onChange={(e) => updateNib("ratio", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.nib.ratio.toFixed(2)}</span>
                    </label>
                    <div className={styles.modeToggle} role="radiogroup" aria-label="Nib shape">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={settings.brush.nib.shape === "ellipse"}
                        className={`${styles.modeBtn} ${settings.brush.nib.shape === "ellipse" ? styles.modeBtnActive : ""}`}
                        onClick={() => updateNib("shape", "ellipse")}
                      >
                        Round
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={settings.brush.nib.shape === "rect"}
                        className={`${styles.modeBtn} ${settings.brush.nib.shape === "rect" ? styles.modeBtnActive : ""}`}
                        onClick={() => updateNib("shape", "rect")}
                      >
                        Cut
                      </button>
                    </div>
                    <label className={styles.sliderRow}>
                      <span>Pressure</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.brush.nib.pressure}
                        onChange={(e) => updateNib("pressure", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.nib.pressure.toFixed(2)}</span>
                    </label>
                  </>
                )}

                {settings.brush.kind === "scatter" && (
                  <>
                    <div className={styles.modeToggle} role="radiogroup" aria-label="Stamp">
                      {STAMP_DEFS.map((s) => (
                        <button
                          key={s.shape}
                          type="button"
                          role="radio"
                          aria-checked={settings.brush.scatter.stamp === s.shape}
                          title={s.label}
                          className={`${styles.modeBtn} ${settings.brush.scatter.stamp === s.shape ? styles.modeBtnActive : ""}`}
                          onClick={() => updateScatter("stamp", s.shape)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <label className={styles.sliderRow}>
                      <span>Spacing</span>
                      <input
                        type="range"
                        min={0.1}
                        max={4}
                        step={0.05}
                        value={settings.brush.scatter.spacing}
                        onChange={(e) => updateScatter("spacing", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.spacing.toFixed(2)}</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Stamp size</span>
                      <input
                        type="range"
                        min={0.05}
                        max={2}
                        step={0.05}
                        value={settings.brush.scatter.size}
                        onChange={(e) => updateScatter("size", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.size.toFixed(2)}</span>
                    </label>
                    <div className={styles.modeToggle} role="radiogroup" aria-label="Stamp rotation">
                      {ROTATION_DEFS.map((r) => (
                        <button
                          key={r.mode}
                          type="button"
                          role="radio"
                          aria-checked={settings.brush.scatter.rotationMode === r.mode}
                          title={r.hint}
                          className={`${styles.modeBtn} ${settings.brush.scatter.rotationMode === r.mode ? styles.modeBtnActive : ""}`}
                          onClick={() => updateScatter("rotationMode", r.mode)}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {/* A fixed offset on top of a random angle is a no-op —
                        hide it there rather than leave a slider that does
                        nothing. */}
                    {settings.brush.scatter.rotationMode !== "random" && (
                      <label className={styles.sliderRow}>
                        <span>Rotation</span>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          step={1}
                          value={settings.brush.scatter.rotation}
                          onChange={(e) => updateScatter("rotation", Number(e.target.value))}
                        />
                        <span className={styles.val}>{settings.brush.scatter.rotation}°</span>
                      </label>
                    )}
                    <label className={styles.sliderRow}>
                      <span>Pressure</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.brush.scatter.pressure}
                        onChange={(e) => updateScatter("pressure", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.pressure.toFixed(2)}</span>
                    </label>
                    <div className={styles.settingsSubLabel}>Jitter</div>
                    <label className={styles.sliderRow}>
                      <span>Size</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.brush.scatter.sizeJitter}
                        onChange={(e) => updateScatter("sizeJitter", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.sizeJitter.toFixed(2)}</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Offset</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.brush.scatter.offsetJitter}
                        onChange={(e) => updateScatter("offsetJitter", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.offsetJitter.toFixed(2)}</span>
                    </label>
                    <label className={styles.sliderRow}>
                      <span>Spacing</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.brush.scatter.spacingJitter}
                        onChange={(e) => updateScatter("spacingJitter", Number(e.target.value))}
                      />
                      <span className={styles.val}>{settings.brush.scatter.spacingJitter.toFixed(2)}</span>
                    </label>
                    {settings.brush.scatter.rotationMode !== "random" && (
                      <label className={styles.sliderRow}>
                        <span>Rotation</span>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          step={1}
                          value={settings.brush.scatter.rotationJitter}
                          onChange={(e) => updateScatter("rotationJitter", Number(e.target.value))}
                        />
                        <span className={styles.val}>{settings.brush.scatter.rotationJitter}°</span>
                      </label>
                    )}
                  </>
                )}

                {/* Streamline smooths the SKELETON, so it applies to every
                    brush — for freehand it's a perfect-freehand option, for the
                    other two it's what buildPathSpace samples. */}
                {(settings.brush.kind !== "freehand" || settings.mode === "dynamic") && (
                  <label className={styles.sliderRow}>
                    <span>Streamline</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.streamline}
                      onChange={(e) => updateSetting("streamline", Number(e.target.value))}
                    />
                    <span className={styles.val}>{settings.streamline.toFixed(2)}</span>
                  </label>
                )}

                {settings.brush.kind !== "freehand" && (
                  <>
                    {/* Every one of these points ends up in the exported glyf
                        table. A stipple brush can reach five figures without
                        looking any different on screen, so the number is shown
                        rather than discovered at export time. */}
                    <div className={styles.brushBudget}>
                      {inkStats.contours.toLocaleString("de-DE")} contours · {inkStats.points.toLocaleString("de-DE")} points
                    </div>
                    <button type="button" className={styles.clearBtn} onClick={resetBrushParams}>
                      Reset brush
                    </button>
                  </>
                )}
              </div>
            </SettingsSection>
          )}
          {/* Below Stroke, not above it: the pen is the control you reach
              for on every visit, while the syllable readout and the four
              font metrics get looked at once and then rest. */}
          {topMode === "draw" && drawStyle === "grid" && (
            <>
            {/* Collapsed by default, Glyphs' Font Info parallel: the four
                font metrics get set once early on and then mostly rest,
                unlike the cell-layout controls above them (still open by
                default, unlike Metrics — just also collapsible now, for
                consistency with every other group in this panel). */}
            {/* Only in Hangul, and only once something has been drawn:
                this panel exists to show that 24 drawings became a
                writing system, which is meaningless with an empty grid. */}
            {activeScript === "hangul" && syllablePreview.length > 0 && (
              <SettingsSection id="syllables" title="Syllables" defaultOpen>
                <div className={styles.syllableGrid}>
                  {syllablePreview.map((s) => (
                    <div key={s.char} className={styles.syllableCell} title={s.char}>
                      <svg viewBox={`0 0 ${HANGUL_EM} ${HANGUL_EM}`} className={styles.syllableSvg}>
                        <path d={s.contours.join(" ")} fill="currentColor" fillRule="nonzero" />
                      </svg>
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.syllableBtn} onClick={() => setSyllableSeed((n) => n + 1)}>
                  Other syllables
                </button>
              </SettingsSection>
            )}

            {/* The payoff for having drawn syllables at all. Shown only once
                there is something to lift: an empty section here would be one
                more thing to wonder about in a panel that already asks a lot. */}
            {activeScript === "hangul" && harvestable.length > 0 && (
              <SettingsSection id="harvest" title="Harvest" defaultOpen>
                <p className={styles.settingsNote}>
                  Lifts each batchim out of the syllable you drew it in, so every one of the 11,172 syllables carries
                  your hand instead of a shrunken copy.
                </p>
                <ul className={styles.harvestList}>
                  {harvestable.map((h) => (
                    <li key={h.char} className={styles.harvestRow}>
                      <span className={styles.harvestChar}>{h.char}</span>
                      <span>
                        {h.results.map((r) => r.name).join(", ")}
                      </span>
                      <span className={styles.val}>
                        {h.results.reduce((n, r) => n + r.strokes.length, 0)}
                      </span>
                    </li>
                  ))}
                </ul>
                <label className={styles.sliderRow}>
                  <span>Weight</span>
                  <input
                    type="range"
                    min={0.8}
                    max={1.3}
                    step={0.01}
                    value={batchimWeight}
                    onChange={(e) => setBatchimWeight(Number(e.target.value))}
                  />
                  <span className={styles.val}>{Math.round(batchimWeight * 100)}%</span>
                </label>
                <p className={styles.settingsNote}>
                  Thickness only — not one point moves. 100% is exactly the weight you drew; a dense batchim often
                  wants a little less so it doesn&rsquo;t clot, a sparse one a little more so it doesn&rsquo;t vanish.
                  Harvest again to apply — it replaces, so nothing drifts.
                </p>
                <button type="button" className={styles.clearBtn} onClick={harvestBatchim}>
                  Harvest {harvestable.length} batchim
                </button>
              </SettingsSection>
            )}

            {/* Hangul never touches these four numbers: its glyphs go through
                emTransform, which maps the em box onto the font's em square and
                advances one em per syllable. Leaving four live-looking sliders
                in the panel would be four controls that do nothing — but
                removing the section outright leaves no answer to "where did
                Metrics go?", so the section stays and says why. */}
            <SettingsSection id="metrics" title="Metrics" defaultOpen={false} tourId="metrics">
              {activeScript === "hangul" ? (
                <p className={styles.settingsNote}>
                  Hangul has no baseline to sit on. Every syllable fills the em square and advances exactly one
                  em — that uniform advance is how Korean is set. Ascender, x-height, baseline and descender
                  govern this font&rsquo;s Latin letters only.
                </p>
              ) : (
              <div className={styles.sliders}>
                <label className={styles.sliderRow}>
                  <span>Ascender</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metrics.ascender}
                    onChange={(e) => updateMetric("ascender", Math.min(Number(e.target.value), metrics.xHeight - 0.02))}
                  />
                  <span className={styles.val}>{metrics.ascender.toFixed(2)}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>X-height</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metrics.xHeight}
                    onChange={(e) =>
                      updateMetric(
                        "xHeight",
                        Math.min(Math.max(Number(e.target.value), metrics.ascender + 0.02), metrics.baseline - 0.02)
                      )
                    }
                  />
                  <span className={styles.val}>{metrics.xHeight.toFixed(2)}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>Baseline</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metrics.baseline}
                    onChange={(e) =>
                      updateMetric(
                        "baseline",
                        Math.min(Math.max(Number(e.target.value), metrics.xHeight + 0.02), metrics.descender - 0.02)
                      )
                    }
                  />
                  <span className={styles.val}>{metrics.baseline.toFixed(2)}</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>Descender</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={metrics.descender}
                    onChange={(e) => updateMetric("descender", Math.max(Number(e.target.value), metrics.baseline + 0.02))}
                  />
                  <span className={styles.val}>{metrics.descender.toFixed(2)}</span>
                </label>
              </div>
              )}
            </SettingsSection>
            </>
          )}
          </div>
        </aside>
      </div>

      {tourActive && <CoachMarks onFinish={finishTour} />}

      {topMode === "draw" && (
        <div className={styles.statusBar}>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>mode</span>
            {drawStyle === "free" ? "Sketcher" : drawStyle === "grid" ? "Grid" : drawStyle === "writer" ? "Writer" : "Typer"}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>pointerType</span>
            {hud.pointerType}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>pressure</span>
            {hud.pressure.toFixed(2)}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>x, y</span>
            {hud.x}, {hud.y}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>strokesSaved</span>
            {strokeCount}
          </span>
        </div>
      )}

      {infoModal && (
        <div className={styles.modalBackdrop} onClick={() => setInfoModal(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>{infoModal === "info" ? "Info" : "How to"}</span>
              <button type="button" className={styles.modalClose} onClick={() => setInfoModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            {infoModal === "info" ? (
              <p className={styles.modalBody}>
                Fontane.Studio turns your own handwriting into a usable font. Draw letters freehand or in the letter grid,
                tag strokes to characters, then export as OTF, JSON, or a skeleton SVG — or save your work as a
                .fff project file to keep editing later.
              </p>
            ) : (
              <ol className={styles.modalList}>
                <li>
                  <strong>Guided tour</strong> — the first visit to Grid walks through the layout automatically;
                  replay it anytime from View → Show tour again.
                </li>
                <li>
                  <strong>Draw</strong> — two ways to capture handwriting. <strong>Free</strong> is an open canvas:
                  sketch anywhere, at any size, in any order. <strong>Grid</strong> is one cell per character —
                  drawing into a cell both captures the stroke and tags it to that letter in one step, no separate
                  Assign needed. Grid cells also show shared baseline/x-height/ascender/descender guides plus
                  draggable per-glyph left/right bearings, which feed real calibration into the font export. The
                  Draw and <strong>Brush</strong> tools both capture a pressure-varying stroke the same way — Brush
                  exists for strokes that trace their own outline rather than a centerline, so it&apos;s left out of
                  Nudge/Anchor editing and the Skeleton SVG export (see below), where a true centerline is what&apos;s
                  needed.
                </li>
                <li>
                  <strong>Character Sets</strong> — Grid starts on Latin Basic. Add Central European, Western
                  European, Cyrillic, Greek, Numbers, Punctuation, or Symbols anytime from the Character Sets menu;
                  cells for any newly added set appear right away.
                </li>
                <li>
                  <strong>The Free Draw workflow</strong> — write freely, select, and assign single letters,
                  numbers, or other glyphs; you can also assign ligatures and alternate letters this way. Three
                  steps: <strong>Draw</strong> to create your letter shapes, <strong>Select</strong> to lasso a
                  letter, glyph, or ligature, then <strong>Assign</strong> to name it into the respective glyph
                  class. From there you can adjust the geometry or side bearings in Grid, or test the result in
                  Editor.
                </li>
                <li>
                  <strong>Select + Assign</strong> (Free only) — lasso strokes with Select, then switch to Assign
                  to name the selection as a Base character, a Ligature (built from component names), or an
                  Alternate (a variant of an existing glyph). Cmd/Ctrl+Enter saves without reaching for the button.
                </li>
                <li>
                  <strong>Reshape</strong> — <strong>Nudge</strong> drags a stroke&apos;s simplified anchor points to
                  reshape its curve. <strong>Anchor</strong> goes further: click an anchor to select it (it stays
                  selected, unlike Nudge&apos;s drag-only grab), then Delete/Backspace removes it and splits the stroke
                  in two at that point. With the Pen tool active on a stroke you&apos;re already editing, clicking
                  between two anchors inserts a new one; clicking directly on one deletes it the same way.
                </li>
                <li>
                  <strong>Transform</strong> — select strokes first (Select/Assign&apos;s lasso), then Move, Rotate, or
                  Scale them as a group. Scale defaults to resizing from the selection&apos;s bottom-left corner,
                  independently per axis; hold <strong>Alt</strong> to scale from the center instead, and{" "}
                  <strong>Shift</strong> to lock proportions. Stroke thickness scales along with the geometry, so
                  resizing never leaves a shape looking disproportionately thick or thin. The Skew horizontal and
                  vertical sliders (shown whenever a selection exists) shear it around its center — both combine
                  cleanly and the whole gesture undoes in one step.
                </li>
                <li>
                  <strong>Preview</strong> — compose text in Editor using already-tagged glyphs, or animate it in
                  Anim.
                </li>
                <li>
                  <strong>Export</strong> — File menu: <strong>OTF</strong> (a real, usable font, built entirely in
                  the browser), <strong>JSON</strong> (the compiled glyph document, for the local TTF script or the
                  Glyphs.app import script), or <strong>Skeleton SVG</strong> (every glyph&apos;s raw centerline as an
                  open path, for hand-building outlines in Glyphs.app or similar — Brush strokes are left out of
                  this one since they don&apos;t have a true centerline to export).
                </li>
                <li>
                  <strong>FFF (Fontane Font File)</strong> — File → Export/Import FFF saves or reopens the whole
                  project: every stroke, glyph, metric, and setting, exactly as the editor keeps it. This is
                  different from the OTF/JSON/Skeleton exports above, which are one-way — once a glyph&apos;s outlines
                  are compiled, the raw pen strokes behind them are gone from that file. An FFF keeps the editable
                  source data instead, so you can save your work, close the tab, and pick up exactly where you left
                  off (here, or on another machine) — it&apos;s the project save file, not a font.
                </li>
              </ol>
            )}
            {infoModal === "howto" && (
              <a
                href="https://cnsl.aisu.studio/submit/fontane-cb43f90b"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.modalLink}
              >
                Missing something? See &amp; suggest features →
              </a>
            )}
          </div>
        </div>
      )}

      {confirmNewFile && (
        <div className={styles.modalBackdrop} onClick={() => setConfirmNewFile(false)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>New File</span>
              <button type="button" className={styles.modalClose} onClick={() => setConfirmNewFile(false)} aria-label="Close">
                ×
              </button>
            </div>
            <p className={styles.modalBody}>Save current project?</p>
            <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
              <button type="button" className={styles.clearBtn} onClick={() => handleNewFile(true)}>
                Yes
              </button>
              <button type="button" className={`${styles.clearBtn} ${styles.dangerBtn}`} onClick={() => handleNewFile(false)}>
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {marketplaceModal === "publish" && (
        <div className={styles.modalBackdrop} onClick={closeMarketplaceModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Publish Font</span>
              <button type="button" className={styles.modalClose} onClick={closeMarketplaceModal} aria-label="Close">
                ×
              </button>
            </div>
            {publishedSlug ? (
              <div style={{ padding: "0 16px 16px" }}>
                <p className={styles.modalBody}>
                  Published as <strong>{publishedSlug}</strong>.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={styles.clearBtn} onClick={() => handleShareCopy(publishedSlug)}>
                    {shareCopyState === "copied" && shareCopiedSlug === publishedSlug
                      ? "Link copied!"
                      : shareCopyState === "failed" && shareCopiedSlug === publishedSlug
                        ? "Copy failed"
                        : "Copy link"}
                  </button>
                  <a href={`/marketplace/${publishedSlug}`} className={styles.clearBtn} style={{ textDecoration: "none" }}>
                    View
                  </a>
                </div>
              </div>
            ) : glyphs.length === 0 ? (
              <p className={styles.modalBody}>Draw and tag at least one glyph before publishing.</p>
            ) : (
              <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Font name"
                    value={publishName}
                    onChange={(e) => setPublishName(e.target.value)}
                  />
                  <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {!publishName.trim()
                      ? " "
                      : slugChecking
                        ? "Checking availability…"
                        : slugCheck?.available
                          ? `Available — fontane.studio/marketplace/${slugCheck.slug}`
                          : slugCheck
                            ? "That name is already taken."
                            : " "}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Author (optional)"
                    value={publishAuthorName}
                    onChange={(e) => setPublishAuthorName(e.target.value)}
                  />
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Author homepage (optional)"
                    value={publishAuthorUrl}
                    onChange={(e) => setPublishAuthorUrl(e.target.value)}
                  />
                </div>
                <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={licenseAccepted}
                    onChange={(e) => setLicenseAccepted(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  I confirm this font may be used 100% unrestricted, for any purpose.
                </label>
                {publishError && <p style={{ color: "#c0334d", fontSize: 13 }}>{publishError}</p>}
                <button
                  type="button"
                  className={styles.clearBtn}
                  disabled={!slugCheck?.available || !licenseAccepted || publishing}
                  onClick={handlePublish}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {marketplaceModal === "share" && (
        <div className={styles.modalBackdrop} onClick={closeMarketplaceModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Share Font</span>
              <button type="button" className={styles.modalClose} onClick={closeMarketplaceModal} aria-label="Close">
                ×
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                className={styles.nameInput}
                style={{ width: "100%" }}
                placeholder="Find a published font by name"
                value={shareQuery}
                onChange={(e) => setShareQuery(e.target.value)}
              />
              {shareSearching && <p style={{ fontSize: 12, opacity: 0.7 }}>Searching…</p>}
              {!shareSearching && shareQuery.trim() && shareResults.length === 0 && (
                <p style={{ fontSize: 12, opacity: 0.7 }}>No fonts found.</p>
              )}
              {shareResults.map((font) => (
                <div key={font.slug} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>{font.display_name}</span>
                  <button type="button" className={styles.clearBtn} onClick={() => handleShareCopy(font.slug)}>
                    {shareCopyState === "copied" && shareCopiedSlug === font.slug
                      ? "Copied!"
                      : shareCopyState === "failed" && shareCopiedSlug === font.slug
                        ? "Failed"
                        : "Copy link"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {cloudModal === "auth" && (
        <div className={styles.modalBackdrop} onClick={() => setCloudModal(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>{authMode === "login" ? "Log In" : "Sign Up"}</span>
              <button type="button" className={styles.modalClose} onClick={() => setCloudModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: 0 }}>
                Free — an account only unlocks cross-device cloud save, everything else stays account-free.
              </p>
              <div className={styles.modeToggle} role="radiogroup" aria-label="Log in or sign up">
                <button
                  type="button"
                  role="radio"
                  aria-checked={authMode === "login"}
                  className={`${styles.modeBtn} ${authMode === "login" ? styles.modeBtnActive : ""}`}
                  onClick={() => { setAuthMode("login"); setCloudError(null); }}
                >
                  Log In
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={authMode === "signup"}
                  className={`${styles.modeBtn} ${authMode === "signup" ? styles.modeBtnActive : ""}`}
                  onClick={() => { setAuthMode("signup"); setCloudError(null); }}
                >
                  Sign Up
                </button>
              </div>
              <input
                type="email"
                className={styles.nameInput}
                style={{ width: "100%" }}
                placeholder="Email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
              <input
                type="password"
                className={styles.nameInput}
                style={{ width: "100%" }}
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && authMode === "login") handleAuthSubmit(); }}
              />
              {authMode === "signup" && (
                <input
                  type="text"
                  className={styles.nameInput}
                  style={{ width: "100%" }}
                  placeholder="Invite code"
                  value={authInviteCode}
                  onChange={(e) => setAuthInviteCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAuthSubmit(); }}
                />
              )}
              {cloudError && <p style={{ fontSize: 12, color: "var(--color-error, #c0392b)" }}>{cloudError}</p>}
              <button
                type="button"
                className={styles.clearBtn}
                disabled={!authEmail.trim() || !authPassword || cloudBusy}
                onClick={handleAuthSubmit}
              >
                {cloudBusy ? "Please wait…" : authMode === "login" ? "Log In" : "Sign Up"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cloudModal === "save" && (
        <div className={styles.modalBackdrop} onClick={() => setCloudModal(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Save to Cloud</span>
              <button type="button" className={styles.modalClose} onClick={() => setCloudModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                className={styles.nameInput}
                style={{ width: "100%" }}
                placeholder="Project name"
                value={cloudSaveAsName}
                onChange={(e) => setCloudSaveAsName(e.target.value)}
              />
              {cloudError && <p style={{ fontSize: 12, color: "var(--color-error, #c0392b)" }}>{cloudError}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={styles.clearBtn}
                  disabled={!cloudSaveAsName.trim() || cloudBusy}
                  onClick={() => handleSaveToCloud(false)}
                >
                  {currentCloudProject ? "Save" : "Save"}
                </button>
                {currentCloudProject && (
                  <button
                    type="button"
                    className={styles.clearBtn}
                    disabled={!cloudSaveAsName.trim() || cloudBusy}
                    onClick={() => handleSaveToCloud(true)}
                  >
                    Save as New
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {cloudModal === "projects" && (
        <div className={styles.modalBackdrop} onClick={() => setCloudModal(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>My Cloud Projects</span>
              <button type="button" className={styles.modalClose} onClick={() => setCloudModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {cloudError && <p style={{ fontSize: 12, color: "var(--color-error, #c0392b)" }}>{cloudError}</p>}
              {cloudProjectsLoading && <p style={{ fontSize: 12, opacity: 0.7 }}>Loading…</p>}
              {!cloudProjectsLoading && cloudProjects.length === 0 && (
                <p style={{ fontSize: 12, opacity: 0.7 }}>No cloud projects yet.</p>
              )}
              {cloudProjects.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    {p.name}
                    <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 6 }}>
                      {new Date(p.updated_at).toLocaleString()}
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className={styles.clearBtn}
                      disabled={cloudBusy}
                      onClick={() => handleLoadCloudProject(p.id, p.name)}
                    >
                      Load
                    </button>
                    <button type="button" className={styles.clearBtn} onClick={() => handleDeleteCloudProject(p.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
