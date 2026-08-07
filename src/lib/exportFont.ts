import { Font, Glyph, Path } from "opentype.js";
import { saveFile } from "./saveFile";
import { emBox } from "./hangul";

// Mirrors font-build/build_ttf.py's glyph naming/metrics/cmap conventions, but
// the actual binary output differs: opentype.js always writes a CFF-flavored
// OTF (it converts our quadratic contours to cubic internally), where the
// Python script writes a real TrueType glyf table. Both are valid, importable
// fonts — this one's just .otf, not .ttf.
const UPM = 1000;
const ASCENT = 800;
const DESCENT = -200;
const DEFAULT_ADVANCE = 600;
const SIDE_BEARING = 40;
// Canvas strokes are drawn at whatever pixel size the user happened to use, with
// no notion of "cap height." Each glyph gets its own drawn bounding box rescaled
// to this height so nothing is exported microscopic or oversized relative to a
// 1000-unit em — a reasonable cap-height-ish target, not a real calibration.
const TARGET_GLYPH_HEIGHT = 700;

export type CompiledGlyph = {
  name: string;
  kind: "base" | "ligature" | "alternate";
  unicode?: string;
  components?: string[];
  alternateOf?: string;
  contours: string[];
  // Grid View guides — present only for glyphs drawn in Grid View, where a
  // shared baseline/ascender/descender plus per-glyph bearings give a real
  // calibration instead of a per-glyph bounding-box guess.
  leftBearing?: number;
  rightBearing?: number;
  cellWidth?: number;
  cellHeight?: number;
  // "hangul" switches this glyph to the em-square calibration (emTransform
  // below) instead of the baseline one. Absent for everything else, so the
  // Latin path is byte-for-byte what it was.
  script?: "hangul";
  // Set on glyphs that were composed rather than drawn. Their contours are
  // already stated in em coordinates, so they must NOT get the drawing-cell
  // inset applied — see emTransform.
  composed?: boolean;
  // Set only by the components-mode composition, which this file's CFF
  // writer can't consume — it rides along in the exported JSON for
  // font-build/build_ttf.py. Shape defined in src/lib/hangulCompose.ts.
  hangulParts?: { jamo: string; xx: number; yy: number; dx: number; dy: number }[];
};

export type DocMetrics ={ ascender: number; baseline: number; descender: number };

export type CompiledDocument = {
  version: number;
  glyphs: CompiledGlyph[];
  metrics?: DocMetrics;
  // The Hangul layout table this document's syllables were composed with.
  //
  // Written by composeHangul, and only for documents that actually contain
  // Hangul. It is not read back here — the browser bakes the geometry into the
  // contours it emits — it exists so the OFFLINE path can agree with what was
  // on screen. font-build/spike-hangul.mjs runs composition again in Node,
  // where the measured table (a browser localStorage setting) does not exist,
  // and would otherwise quietly re-lay every syllable with the shipped guess.
  //
  // Typed loosely on purpose: exportFont.ts is the boundary between the app
  // and its file format, and importing the layout types here would make the
  // format depend on the geometry module rather than the other way round.
  hangulLayout?: Record<string, unknown>;
};

type RawCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

// L belongs here because a glyph drawn with a nib or stipple brush emits
// straight-edged contours (contour.ts's outlineToSharpPath) rather than the
// midpoint quadratics a freehand outline produces. Without it the tokenizer
// below fell through to its Z branch on every L and on each of its two
// coordinates, compiling those glyphs to nothing.
const TOKEN_RE = /[MLQZ]|-?\d+(?:\.\d+)?/g;

// Parses one "M x y Q cx cy x y Q ... Z" path string (src/lib/contour.ts
// output) into structured commands — same token shape as build_ttf.py's regex
// tokenizer, just kept as data instead of being fed straight into a pen, so a
// bounding box can be computed before anything gets drawn.
function parseContour(d: string): RawCommand[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const commands: RawCommand[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M") {
      commands.push({ type: "M", x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) });
      i += 3;
    } else if (tok === "L") {
      commands.push({ type: "L", x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) });
      i += 3;
    } else if (tok === "Q") {
      commands.push({
        type: "Q",
        cx: Number(tokens[i + 1]),
        cy: Number(tokens[i + 2]),
        x: Number(tokens[i + 3]),
        y: Number(tokens[i + 4]),
      });
      i += 5;
    } else {
      commands.push({ type: "Z" });
      i += 1;
    }
  }
  return commands;
}

function boundsOf(contours: RawCommand[][]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const commands of contours) {
    for (const c of commands) {
      if (c.type === "Z") continue;
      xmin = Math.min(xmin, c.x);
      xmax = Math.max(xmax, c.x);
      ymin = Math.min(ymin, c.y);
      ymax = Math.max(ymax, c.y);
    }
  }
  return xmin === Infinity ? null : { xmin, xmax, ymin, ymax };
}

// Canvas space is x-right/y-down with no baseline; font space is x-right/y-up
// with y=0 as the baseline. tx/ty carry the actual mapping — either guide-
// based (see glyphTransform below) or the bbox-fallback in buildFont — so this
// stays agnostic to which. Applied uniformly to on-curve and control points
// alike, which is safe: an affine transform commutes with quadratic Bezier
// evaluation.
function addContourToPath(path: Path, commands: RawCommand[], tx: (x: number) => number, ty: (y: number) => number) {
  let started = false;
  for (const c of commands) {
    if (c.type === "M") {
      path.moveTo(tx(c.x), ty(c.y));
      started = true;
    } else if (c.type === "L") {
      path.lineTo(tx(c.x), ty(c.y));
    } else if (c.type === "Q") {
      path.quadraticCurveTo(tx(c.cx), ty(c.cy), tx(c.x), ty(c.y));
    } else if (started) {
      path.close();
    }
  }
}

type Transform = { tx: (x: number) => number; ty: (y: number) => number; advanceWidth: number };

// Grid View glyphs carry a real calibration: the document's shared baseline/
// ascender fractions plus this glyph's own draggable left/right bearings,
// both resolved against the cell's pixel size at draw time (cellWidth/
// cellHeight — captured once so a later window resize can't shift already-
// drawn glyphs relative to each other).
function guideTransform(entry: CompiledGlyph, metrics: DocMetrics): Transform | null {
  const { leftBearing, rightBearing, cellWidth, cellHeight } = entry;
  if (leftBearing == null || rightBearing == null || !cellWidth || !cellHeight) return null;

  const baselinePx = metrics.baseline * cellHeight;
  const ascenderPx = metrics.ascender * cellHeight;
  const leftPx = leftBearing * cellWidth;
  const rightPx = rightBearing * cellWidth;

  const span = baselinePx - ascenderPx;
  const scale = span > 0 ? ASCENT / span : 1;

  return {
    tx: (x) => (x - leftPx) * scale,
    ty: (y) => (baselinePx - y) * scale,
    advanceWidth: Math.max(Math.round((rightPx - leftPx) * scale), 1),
  };
}

// Hangul's calibration. No baseline is involved: the glyph was drawn inside
// (or composed into) a square em box, and it maps onto the font's em square —
// top edge at the ascender, bottom edge one em below it, advance exactly one
// em for every syllable. That uniform advance is not a simplification; it is
// how Korean is set.
//
// The source square comes from emBox() in src/lib/hangul.ts — the same
// function that draws the guides, so what the user sees as the em really is
// the box that maps onto the font's em. It is deliberately smaller than the
// canvas: a jamo drawn right up to the cell edge should overshoot the em a
// little rather than define it.
function emTransform(entry: CompiledGlyph): Transform | null {
  const { cellWidth, cellHeight } = entry;
  if (!cellWidth || !cellHeight) return null;
  // A DRAWN jamo sits in a cell that is deliberately bigger than the em, so
  // there's air to draw into and room to overshoot — emBox() finds the em
  // inside it. A COMPOSED syllable has no cell: its contours were laid out in
  // em coordinates to begin with, so the box is the whole thing. Running the
  // inset over those would scale every syllable up by 1/EM_BOX_FRACTION and
  // push the batchim out through the bottom of the em, which is exactly what
  // it did until this branch existed.
  const box = entry.composed
    ? { x: 0, y: 0, size: Math.min(cellWidth, cellHeight) }
    : emBox(cellWidth, cellHeight);
  const scale = UPM / box.size;
  return {
    tx: (x) => (x - box.x) * scale,
    ty: (y) => ASCENT - (y - box.y) * scale,
    advanceWidth: UPM,
  };
}

// Fallback for glyphs with no Grid View guide data (e.g. tagged via Write
// mode's lasso-select): rescale the glyph's own drawn bounding box to a fixed
// cap-height-ish target. No cross-glyph consistency, but nothing comes out
// microscopic, oversized, or upside-down either.
function bboxTransform(contours: RawCommand[][]): Transform | null {
  const bbox = boundsOf(contours);
  if (!bbox) return null;
  const height = bbox.ymax - bbox.ymin;
  const scale = height > 0 ? TARGET_GLYPH_HEIGHT / height : 1;
  return {
    tx: (x) => (x - bbox.xmin) * scale + SIDE_BEARING,
    ty: (y) => (bbox.ymax - y) * scale,
    advanceWidth: Math.max(Math.round((bbox.xmax - bbox.xmin) * scale + 2 * SIDE_BEARING), 1),
  };
}

function glyphNameFor(entry: CompiledGlyph): string {
  if (entry.kind === "ligature" && entry.components?.length) {
    return entry.components.join("_") + ".liga";
  }
  return entry.name;
}

// @types/opentype.js mistypes Font.substitution as `(font: Font) => any`
// (a stale/wrong guess — the real runtime object, straight from opentype.js's
// own source, is a Substitution instance with add/addLigature/addSingle/
// addAlternate/getFeature/getTable/getLookupTables methods, all confirmed by
// reading the actual library source, not the type package). This is the real
// shape of the methods this file actually calls — getTable/getLookupTables
// are the lower-level Layout-class methods (Substitution extends Layout)
// needed for calt below, since there's no high-level add() case for
// chaining-context lookups the way there is for liga.
type GsubCoverage = { format: 1; glyphs: number[] };
type GsubLookup = { lookupType: number; lookupFlag: number; subtables: unknown[] };
type SubstitutionApi = {
  add(feature: string, sub: { sub: number[]; by: number }, script?: string, language?: string): void;
  getTable(create: boolean): { lookups: GsubLookup[] };
  getLookupTables(script: string | undefined, language: string | undefined, feature: string, lookupType: number, create: boolean): GsubLookup[];
};

// Wires up a real GSUB 'liga' feature (LookupType 4, Ligature Substitution)
// for every ligature glyph — until now, a "ligature" was only ever a
// separately-named glyph (see glyphNameFor's `f_i.liga` convention) with no
// actual substitution rule anywhere in the pipeline, reachable only by
// direct glyph-index access. opentype.js's font.substitution API (a real,
// documented wrapper around raw GSUB table construction — no manual Table/
// Coverage/LookupList assembly needed) builds the DFLT script/langsys/
// feature/lookup structure lazily, only if this ever actually calls .add(),
// so a document with zero ligatures still emits a font with no GSUB table
// at all — this can't make an export worse, only sometimes better.
function wireLigatures(font: Font, doc: CompiledDocument, nameToIndex: Map<string, number>) {
  const substitution = font.substitution as unknown as SubstitutionApi;
  for (const entry of doc.glyphs) {
    if (entry.kind !== "ligature" || !entry.components?.length) continue;
    const ligatureIndex = nameToIndex.get(glyphNameFor(entry));
    const componentIndices = entry.components.map((name) => nameToIndex.get(name));
    if (ligatureIndex == null || componentIndices.some((i) => i == null)) continue; // a component glyph isn't in this export — skip rather than guess
    substitution.add("liga", { sub: componentIndices as number[], by: ligatureIndex });
  }
}

// Wires up a real GSUB 'calt' feature so a base letter drawn with stylistic
// alternates doesn't render as an identical stamp every time it repeats —
// the classic hand-lettering-font trick, and the actual reason this matters
// more for a handwriting tool than kerning does: identical repeated letters
// read as mechanical in a way imprecise spacing never does.
//
// Cycles through every alternate of a base letter, in creation order (the
// order alternatesByBase collects them in, which is also baked into their
// auto-generated names — see nextAlternateName in glyphs.ts): the 2nd
// occurrence of "e" becomes e.alt1, the 3rd becomes e.alt2, and so on. Each
// step is its own backtrack=[previous step's result] rule, chained onto the
// same lookup — this relies on a real shaper (HarfBuzz, CoreText, ...)
// applying calt's subtables left-to-right over the actual glyph sequence, so
// by the time it reaches the 3rd "e" the 2nd has already become e.alt1 and
// is what the 3rd rule's backtrack coverage matches against.
//
// What happens after the last alternate is NOT "holds on it" — there's no
// rule for backtrack=[last alt], so the next repeat falls through with no
// substitution at all and renders as the plain base again, which then feeds
// step 1's rule and restarts the whole cycle (base, alt1, alt2, base, alt1,
// alt2, ...). This is deliberate, confirmed with Dom: real rotation (looping
// back through the base) beats freezing on the last alternate for repeated
// runs — a frozen alternate would just trade one mechanical stamp for
// another. Confirmed live: a synthetic 3-shape (circle/square/triangle) test
// font, built with this exact function and rendered via @font-face in a real
// browser (real HarfBuzz/CoreText shaping, not just GSUB-table inspection),
// showed exactly this base/alt1/alt2/base/alt1 cycle for "eeeee".
//
// No high-level Substitution.add() case exists for chaining-context lookups
// (LookupType 6) the way there is for liga, so this uses the lower-level
// Layout methods (getTable/getLookupTables) both classes share, matching
// exactly the shape opentype.js's own GSUB parser/writer expect for a Format
// 3 (coverage-based) chaining context subtable: one glyph of backtrack, one
// glyph of input (the repeat that should change), and a lookupRecord
// pointing at a plain single-substitution lookup (added to the lookup list
// but deliberately never registered under any feature of its own — chaining
// context is the only thing that ever invokes it, exactly like real-world
// calt implementations).
//
// Must run BEFORE wireLigatures: opentype.js's feature table requires
// features to be added in alphabetical tag order ("calt" < "liga"), and
// getFeatureTable() asserts that order when creating a new entry.
function wireContextualAlternates(font: Font, doc: CompiledDocument, nameToIndex: Map<string, number>) {
  const alternatesByBase = new Map<string, string[]>();
  for (const entry of doc.glyphs) {
    if (entry.kind === "alternate" && entry.alternateOf) {
      const list = alternatesByBase.get(entry.alternateOf) ?? [];
      list.push(entry.name);
      alternatesByBase.set(entry.alternateOf, list);
    }
  }
  if (alternatesByBase.size === 0) return;

  const gsub = font.substitution as unknown as SubstitutionApi;
  const table = gsub.getTable(true);

  for (const [baseName, altNames] of alternatesByBase) {
    const baseIndex = nameToIndex.get(baseName);
    if (baseIndex == null) continue;
    const baseCoverage: GsubCoverage = { format: 1, glyphs: [baseIndex] };

    // backtrackIndex tracks what the *previous* occurrence resolved to —
    // base itself for the first repeat, then each alternate in turn.
    let backtrackIndex = baseIndex;
    for (const altName of altNames) {
      const altIndex = nameToIndex.get(altName);
      if (altIndex == null) continue;

      const backtrackCoverage: GsubCoverage = { format: 1, glyphs: [backtrackIndex] };
      const actionLookupIndex = table.lookups.length;
      table.lookups.push({
        lookupType: 1,
        lookupFlag: 0,
        subtables: [{ substFormat: 2, coverage: baseCoverage, substitute: [altIndex] }],
      });

      const [chainLookup] = gsub.getLookupTables("DFLT", "dflt", "calt", 6, true);
      chainLookup.subtables.push({
        substFormat: 3,
        backtrackCoverage: [backtrackCoverage],
        inputCoverage: [baseCoverage],
        lookaheadCoverage: [],
        lookupRecords: [{ sequenceIndex: 0, lookupListIndex: actionLookupIndex }],
      });

      backtrackIndex = altIndex;
    }
  }
}

export function buildFont(doc: CompiledDocument, familyName = "Fontane Sketch", styleName = "Regular"): Font {
  const notdefGlyph = new Glyph({
    name: ".notdef",
    advanceWidth: DEFAULT_ADVANCE,
    path: new Path(),
  });

  const glyphs: Glyph[] = [notdefGlyph];
  const nameToIndex = new Map<string, number>();

  for (const entry of doc.glyphs) {
    const contours = entry.contours.map(parseContour);
    const transform =
      (entry.script === "hangul" ? emTransform(entry) : doc.metrics && guideTransform(entry, doc.metrics)) ??
      bboxTransform(contours);

    const path = new Path();
    let advanceWidth = DEFAULT_ADVANCE;

    if (transform) {
      for (const commands of contours) addContourToPath(path, commands, transform.tx, transform.ty);
      advanceWidth = transform.advanceWidth;
    }

    const unicodes =
      entry.kind === "base" && entry.unicode
        ? [parseInt(entry.unicode.replace("U+", ""), 16)]
        : undefined;

    nameToIndex.set(glyphNameFor(entry), glyphs.length);
    glyphs.push(
      new Glyph({
        name: glyphNameFor(entry),
        unicodes,
        advanceWidth,
        path,
      })
    );
  }

  const font = new Font({
    familyName,
    styleName,
    unitsPerEm: UPM,
    ascender: ASCENT,
    descender: DESCENT,
    glyphs,
  });

  wireContextualAlternates(font, doc, nameToIndex); // must run before wireLigatures — alphabetical feature-tag order
  wireLigatures(font, doc, nameToIndex);

  return font;
}

export function downloadFont(doc: CompiledDocument, fileName = "fontane.otf") {
  const font = buildFont(doc);
  const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
  saveFile(blob, {
    suggestedName: fileName,
    mimeType: "font/otf",
    extension: "otf",
    description: "OpenType font",
  });
}
