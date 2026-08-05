// Turns drawn jamo into composed Hangul syllables, at the level of compiled
// contours (SVG path strings) rather than strokes.
//
// That level is deliberate. compileDocument() has already unioned each
// glyph's strokes into outlines by the time this runs, so composition is
// pure affine geometry on path strings — no perfect-freehand, no polygon
// clipping, nothing that would have to be re-run per syllable. It also means
// this module works identically in the browser and in font-build's offline
// script.
//
// What is NOT here, on purpose: any notion of storing syllables. All 11.172
// of them are a function of 24 drawings, and materializing even the common
// 2.350 into glyph/stroke state would blow the localStorage budget for no
// gain. Composition happens at export time and, for a handful of syllables
// at a time, in the preview.

import type { CompiledDocument, CompiledGlyph } from "./exportFont";
import {
  BASIC_JAMO,
  SYLLABLE_BASE,
  SYLLABLE_LAST,
  frequentSyllables,
  placementFor,
  type JamoPlacement,
  type LayoutTable,
} from "./hangul";

// The composed em box, in the same y-down space the compiled contours already
// use. Paired with emTransform() in exportFont.ts this maps 1:1 onto a
// 1000-unit em; nothing else in the pipeline needs to know the number.
export const HANGUL_EM = 1000;

// How much of its slot a jamo is allowed to fill. Slightly under 1 because
// real Korean faces leave a little air between the initial and the vowel even
// at full size — at exactly 1 the parts touch and the syllable reads as one
// blob at text sizes.
const SLOT_FILL = 0.94;

// Where a standalone jamo (typed on its own, before a syllable is finished)
// sits in the em box. Centred rather than filling it, which is the Korean
// convention for an isolated letter.
const STANDALONE_RECT = { x: 0.18, y: 0.15, w: 0.64, h: 0.7 };

export type FitMode = "uniform" | "stretch";

// Op plus a flat coordinate list, rather than a tuple per command shape: the
// transforms below only ever walk the numbers in pairs, and a shape-specific
// union would mean a switch in every one of them.
type Command = { op: "M" | "L" | "Q" | "Z"; pts: number[] };

const TOKEN_RE = /[MLQZ]|-?\d+(?:\.\d+)?/g;

function parsePath(d: string): Command[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const out: Command[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M" || tok === "L") {
      out.push({ op: tok, pts: [Number(tokens[i + 1]), Number(tokens[i + 2])] });
      i += 3;
    } else if (tok === "Q") {
      out.push({
        op: "Q",
        pts: [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3]), Number(tokens[i + 4])],
      });
      i += 5;
    } else {
      out.push({ op: "Z", pts: [] });
      i += 1;
    }
  }
  return out;
}

// One decimal is far below a font unit's resolution at UPM 1000 and shaves
// roughly a third off the serialized size — which matters when a document
// carries thousands of syllables.
const r1 = (n: number) => Math.round(n * 10) / 10;

function serializePath(cmds: Command[]): string {
  return cmds.map((c) => (c.op === "Z" ? "Z" : `${c.op} ${c.pts.map(r1).join(" ")}`)).join(" ");
}

type Bounds = { xmin: number; xmax: number; ymin: number; ymax: number };

function boundsOf(contours: Command[][]): Bounds | null {
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (const cmds of contours) {
    for (const c of cmds) {
      for (let i = 0; i < c.pts.length; i += 2) {
        xmin = Math.min(xmin, c.pts[i]);
        xmax = Math.max(xmax, c.pts[i]);
        ymin = Math.min(ymin, c.pts[i + 1]);
        ymax = Math.max(ymax, c.pts[i + 1]);
      }
    }
  }
  return xmin === Infinity ? null : { xmin, xmax, ymin, ymax };
}

// Maps a jamo's own ink box into a target rect of the em box.
//
// "uniform" scales both axes by the same factor and centres what's left, so
// ㅇ stays a circle and ㅡ stays a thin bar. "stretch" fills the slot exactly
// and distorts. Uniform is the default because the alternative gives every ㅇ
// an eccentricity that depends on which syllable it lands in — the fastest
// way to make composed text look synthetic. The option exists so the two can
// be compared on real handwriting rather than argued about.
export type InkBounds = { xmin: number; xmax: number; ymin: number; ymax: number };

// The placement rule itself, in whatever unit the caller's em is expressed in.
// Exported because the on-screen preview (layoutText.ts) has to place jamo by
// exactly the same rule as the export does — it just works on stroke points in
// line pixels instead of contours in font units. One rule, two coordinate
// systems; two copies of the arithmetic would drift and the drift would only
// show up as "the preview lies".
export function fitInSlot(
  bbox: InkBounds,
  rect: { x: number; y: number; w: number; h: number },
  emSize: number,
  mode: FitMode = "uniform",
  // Optical correction — see JAMO_OPTICAL_WEIGHT in hangul.ts. 1 leaves the
  // plain fit untouched.
  weight = 1
): { sx: number; sy: number; originX: number; originY: number } {
  const srcW = Math.max(bbox.xmax - bbox.xmin, 1e-6);
  const srcH = Math.max(bbox.ymax - bbox.ymin, 1e-6);
  const dstW = rect.w * emSize * SLOT_FILL;
  const dstH = rect.h * emSize * SLOT_FILL;
  const fitted = Math.min(dstW / srcW, dstH / srcH);
  // Clamped at the slot's *longer* dimension: a round jamo may grow past the
  // axis that limited it, which is the whole point, but never past the slot
  // itself — otherwise ㅇ in a batchim band would spill into the vowel above.
  const boosted = Math.min(fitted * weight, Math.max(dstW / srcW, dstH / srcH));
  const sx = mode === "stretch" ? dstW / srcW : boosted;
  const sy = mode === "stretch" ? dstH / srcH : boosted;
  return {
    sx,
    sy,
    originX: rect.x * emSize + (rect.w * emSize - srcW * sx) / 2,
    originY: rect.y * emSize + (rect.h * emSize - srcH * sy) / 2,
  };
}

function fitTransform(bbox: Bounds, rect: { x: number; y: number; w: number; h: number }, mode: FitMode, weight = 1) {
  const { sx, sy, originX, originY } = fitInSlot(bbox, rect, HANGUL_EM, mode, weight);
  return {
    sx,
    sy,
    originX,
    originY,
    x: (x: number) => originX + (x - bbox.xmin) * sx,
    y: (y: number) => originY + (y - bbox.ymin) * sy,
  };
}

function applyTransform(contours: Command[][], t: { x: (n: number) => number; y: (n: number) => number }): Command[][] {
  return contours.map((cmds) =>
    cmds.map((c): Command => ({
      op: c.op,
      pts: c.pts.map((v, i) => (i % 2 === 0 ? t.x(v) : t.y(v))),
    }))
  );
}

// Fontane names a glyph after the character itself ("a"), which the post
// table can't hold for anything outside Latin-1 — fontTools raises
// UnicodeEncodeError on the first ㄱ. Hangul glyphs therefore get AGL-style
// uniXXXX names. The cmap entry still comes from `unicode`, so nothing about
// how the font is used changes; only the internal name does.
export function hangulGlyphName(codepoint: number): string {
  return `uni${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

// A drawing plus the cell it was made in. The cell matters for variants: they
// are placed by their cell, not by their ink — see partTransform.
export type JamoDrawing = { contours: Command[][]; cellWidth?: number; cellHeight?: number };
export type JamoSource = Map<string, JamoDrawing>;

const VARIANT_NAME_RE = /^(.)\.(initV|initH|fin)$/u;

function isJamoName(name: string): boolean {
  if (BASIC_JAMO.includes(name)) return true;
  const m = VARIANT_NAME_RE.exec(name);
  return Boolean(m && BASIC_JAMO.includes(m[1]));
}

// Pulls the drawn jamo — basics and context variants alike — out of a compiled
// document. Anything else (Latin, ligatures, half-finished cells with no
// contours) is ignored.
export function jamoFrom(doc: CompiledDocument): JamoSource {
  const source: JamoSource = new Map();
  for (const g of doc.glyphs) {
    if (g.kind !== "base" || !g.contours.length) continue;
    if (!isJamoName(g.name)) continue;
    source.set(g.name, {
      contours: g.contours.map(parsePath),
      cellWidth: g.cellWidth,
      cellHeight: g.cellHeight,
    });
  }
  return source;
}

// Only the 24 basics — the variants are a refinement on top and shouldn't
// inflate the "how much is drawn" count.
export function drawnJamoCount(doc: CompiledDocument): number {
  return [...jamoFrom(doc).keys()].filter((n) => BASIC_JAMO.includes(n)).length;
}

// Where one part of a syllable goes, as a single scale plus an offset.
//
// The two branches are the whole point of context variants:
//
//   A VARIANT is placed by its CELL. It was drawn in a cell shaped like the
//   slot it fills, so mapping cell → slot is a near-identity — and because
//   every cell derives from the same cellSize, every part of a syllable comes
//   out at nearly the same scale, which is what keeps the stroke weight even.
//
//   A BASIC jamo is placed by its INK, fitted into the slot. That's the
//   fallback, and it's exactly where the weight problem lives: a jamo squeezed
//   into a batchim band comes out at ~56% scale, and its strokes with it.
export function partTransform(
  placement: JamoPlacement,
  ink: InkBounds,
  drawing: JamoDrawing,
  emSize: number,
  fit: FitMode = "uniform"
): { scale: number; dx: number; dy: number } {
  const rect = placement.rect;
  if (placement.variant && drawing.cellWidth && drawing.cellHeight) {
    const dstW = rect.w * emSize;
    const dstH = rect.h * emSize;
    // Cell-to-slot only pays off when the cell really is shaped like the slot.
    // One context can cover several layout classes whose slots differ — the
    // initial beside a vertical vowel is 0.52 x 0.78 of the em without a
    // batchim and 0.50 x 0.54 with one — and forcing a tall cell into the
    // shorter slot shrinks it to 60% of what the ink fit would have given.
    // That would make a drawn variant WORSE than no variant, so a cell whose
    // proportions are off by more than a sixth falls back to the ink fit.
    const ratio = drawing.cellHeight / drawing.cellWidth / (rect.h / rect.w);
    if (Math.abs(Math.log(ratio)) < 0.16) {
      // Contain, not fill: the cell is only ever shrunk to fit, never
      // stretched, so a jamo can't be distorted by a slot it nearly matches.
      const scale = Math.min(dstW / drawing.cellWidth, dstH / drawing.cellHeight);
      return {
        scale,
        dx: rect.x * emSize + (dstW - drawing.cellWidth * scale) / 2,
        dy: rect.y * emSize + (dstH - drawing.cellHeight * scale) / 2,
      };
    }
  }
  const f = fitInSlot(ink, rect, emSize, fit, placement.weight);
  return { scale: f.sx, dx: f.originX - ink.xmin * f.sx, dy: f.originY - ink.ymin * f.sy };
}

// One syllable's contours, in the em box. Returns null when any jamo it needs
// hasn't been drawn yet — callers skip rather than emit a half-syllable,
// which would look like a bug in the font rather than a gap in the drawing.
export function composeSyllable(
  codepoint: number,
  source: JamoSource,
  fit: FitMode = "uniform",
  layout?: LayoutTable
): string[] | null {
  const placements = placementFor(codepoint, layout, (name) => source.has(name));
  if (!placements) return null;
  const out: string[] = [];
  for (const p of placements) {
    const drawing = source.get(p.jamo);
    if (!drawing) return null;
    const bbox = boundsOf(drawing.contours);
    if (!bbox) return null;
    const t = partTransform(p, bbox, drawing, HANGUL_EM, fit);
    const apply = { x: (x: number) => x * t.scale + t.dx, y: (y: number) => y * t.scale + t.dy };
    for (const cmds of applyTransform(drawing.contours, apply)) {
      out.push(serializePath(cmds));
    }
  }
  return out;
}

// A jamo as its own glyph in the em box — same box as the syllables, so a
// standalone ㄱ and the ㄱ inside 가 come out at a consistent weight.
function composeStandalone(jamo: string, source: JamoSource): string[] | null {
  const drawing = source.get(jamo);
  if (!drawing) return null;
  const bbox = boundsOf(drawing.contours);
  if (!bbox) return null;
  return applyTransform(drawing.contours, fitTransform(bbox, STANDALONE_RECT, "uniform")).map(serializePath);
}

// A syllable expressed as references to the jamo glyphs instead of copies of
// their outlines — the difference between ~25 MB and ~1 MB for the full
// 11.172, because every syllable then costs three component records rather
// than three duplicated outlines.
//
// Only the offline TrueType build can use this: composites live in the glyf
// table, and opentype.js writes CFF, which has no equivalent the library
// exposes. So the browser keeps baking outlines and this rides along in the
// exported JSON for font-build/build_ttf.py.
export type HangulPart = {
  jamo: string; // the component glyph's name — a jamo is its own glyph too
  // A scale-and-offset transform in FONT space (y up, baseline at 0), taking
  // the standalone jamo glyph onto this syllable's slot. Derived rather than
  // measured: the standalone glyph is itself the jamo's ink fitted into
  // STANDALONE_RECT, so going from there to any other slot is the ratio of
  // the two fits. No rotation or skew is ever involved, which is what keeps
  // this expressible as a TrueType component at all.
  xx: number;
  yy: number;
  dx: number;
  dy: number;
};

// Font space's baseline offset — the top of the em box in font units. Kept
// here rather than imported from exportFont.ts so this module stays free of
// the opentype.js side of the pipeline; both refer to the same 800.
const FONT_ASCENT = 800;

export function composeSyllableParts(
  codepoint: number,
  source: JamoSource,
  fit: FitMode = "uniform",
  layout?: LayoutTable
): HangulPart[] | null {
  const placements = placementFor(codepoint, layout, (name) => source.has(name));
  if (!placements) return null;
  const parts: HangulPart[] = [];
  for (const p of placements) {
    const drawing = source.get(p.jamo);
    if (!drawing) return null;
    const bbox = boundsOf(drawing.contours);
    if (!bbox) return null;
    const target = fitTransform(bbox, p.rect, fit, p.weight);
    const standalone = fitTransform(bbox, STANDALONE_RECT, "uniform");
    const xx = target.sx / standalone.sx;
    const yy = target.sy / standalone.sy;
    parts.push({
      // The component's GLYPH name, not the character — see hangulGlyphName.
      jamo: hangulGlyphName(p.jamo.codePointAt(0)!),
      xx,
      yy,
      dx: target.originX - xx * standalone.originX,
      // y is flipped between doc space (down) and font space (up), so the
      // offset is derived from the flipped origins, not the raw ones.
      dy: FONT_ASCENT - target.originY - yy * (FONT_ASCENT - standalone.originY),
    });
  }
  return parts;
}

export type ComposeOptions = {
  // "common" is the ~2.350-syllable band that covers ordinary Korean text and
  // keeps a browser-built OTF in the single-digit MB range; "all" is the full
  // 11.172 and is meant for the offline composite build. An explicit list is
  // what the preview uses.
  set?: "common" | "all" | number[];
  fit?: FitMode;
  layout?: LayoutTable;
  // "outline" bakes each syllable's contours (the only thing the browser's
  // CFF writer can consume); "components" emits jamo references instead, for
  // the offline TrueType build. See HangulPart.
  mode?: "outline" | "components";
};

// Appends composed syllables (and em-normalized jamo) to a compiled document.
// Non-Hangul glyphs pass through untouched, so a font with both scripts
// exports in one go.
export function composeHangul(doc: CompiledDocument, options: ComposeOptions = {}): CompiledDocument {
  const source = jamoFrom(doc);
  if (source.size === 0) return doc;

  const fit = options.fit ?? "uniform";
  let targets: number[];
  if (Array.isArray(options.set)) targets = options.set;
  else if (options.set === "all") {
    targets = [];
    for (let cp = SYLLABLE_BASE; cp <= SYLLABLE_LAST; cp++) targets.push(cp);
  } else targets = frequentSyllables();

  const composed: CompiledGlyph[] = [];

  // The drawn jamo are replaced rather than left as they were: their own
  // cells are Latin-sized canvases, and re-emitting them in the em box is
  // what makes a standalone ㄱ match the ㄱ inside a syllable.
  const jamoNames = new Set(source.keys());
  const standalone = [...source.keys()].filter((n) => BASIC_JAMO.includes(n));

  // Syllables somebody drew by hand — the practice sheet the context variants
  // are harvested from (src/lib/hangulHarvest.ts). A hand-drawn syllable beats
  // an assembled one, so it wins over the composed version rather than sitting
  // beside it: left alone, both would claim the same codepoint, and the drawn
  // one would carry the name "각" into a post table that can only hold ASCII.
  // Renamed to uniXXXX here, exactly as the standalone jamo are.
  const drawnSyllables = new Map<number, CompiledGlyph>();
  for (const g of doc.glyphs) {
    const cp = [...g.name].length === 1 ? g.name.codePointAt(0) : undefined;
    if (cp === undefined || cp < SYLLABLE_BASE || cp > SYLLABLE_LAST) continue;
    if (g.contours.length === 0) continue;
    drawnSyllables.set(cp, g);
  }

  // By name, not by first codepoint: a ligature called "각각" starts with the
  // same codepoint and is not the same glyph.
  const drawnSyllableNames = new Set([...drawnSyllables.keys()].map((cp) => String.fromCodePoint(cp)));
  const rest = doc.glyphs.filter((g) => !jamoNames.has(g.name) && !drawnSyllableNames.has(g.name));
  for (const [cp, g] of drawnSyllables) {
    composed.push({ ...g, name: hangulGlyphName(cp), unicode: `U+${cp.toString(16).toUpperCase()}`, script: "hangul" });
  }
  for (const jamo of standalone) {
    const contours = composeStandalone(jamo, source);
    if (!contours) continue;
    composed.push({
      name: hangulGlyphName(jamo.codePointAt(0)!),
      kind: "base",
      unicode: `U+${jamo.codePointAt(0)!.toString(16).toUpperCase()}`,
      contours,
      script: "hangul",
      composed: true,
      cellWidth: HANGUL_EM,
      cellHeight: HANGUL_EM,
      // Only the browser export reads `script`; font-build/build_ttf.py still
      // goes through the shared guide transform, and these two values are what
      // make that transform an identity onto the em (see the offline script's
      // header for the derivation).
      leftBearing: 0,
      rightBearing: 1,
    });
  }

  const asComponents = options.mode === "components";
  for (const cp of targets) {
    if (drawnSyllables.has(cp)) continue; // the hand-drawn one is already in
    // Both modes describe the same geometry; they differ only in whether the
    // jamo's outline is copied in or pointed at.
    const parts = asComponents ? composeSyllableParts(cp, source, fit, options.layout) : null;
    const contours = asComponents ? [] : composeSyllable(cp, source, fit, options.layout);
    if (asComponents ? !parts : !contours) continue;
    composed.push({
      name: hangulGlyphName(cp),
      kind: "base",
      unicode: `U+${cp.toString(16).toUpperCase()}`,
      contours: contours ?? [],
      ...(parts ? { hangulParts: parts } : {}),
      script: "hangul",
      composed: true,
      cellWidth: HANGUL_EM,
      cellHeight: HANGUL_EM,
      // Only the browser export reads `script`; font-build/build_ttf.py still
      // goes through the shared guide transform, and these two values are what
      // make that transform an identity onto the em (see the offline script's
      // header for the derivation).
      leftBearing: 0,
      rightBearing: 1,
    });
  }

  return { ...doc, glyphs: [...rest, ...composed] };
}
