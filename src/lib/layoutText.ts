import type { Glyph } from "./glyphs";
import type { Stroke, StrokeKind, StrokePoint } from "./strokes";
import type { Metrics } from "./metrics";
import type { VectorShape } from "./vectorShapes";
import { flattenVectorShape } from "./contour";

// A shared row-of-text pixel space for the Animate preview/export — not a
// real font em, just fixed constants big enough that every glyph (Grid- or
// Free-tagged) lands on the same baseline at a comparable size.
const TARGET_CAP_HEIGHT = 140;
const BASELINE_Y = 100;
const SPACE_ADVANCE = TARGET_CAP_HEIGHT * 0.4;
const FALLBACK_SIDE_BEARING = TARGET_CAP_HEIGHT * 0.08;

export type LaidOutEntry =
  | {
      kind: "glyph";
      glyph: Glyph;
      // Raw, untransformed points — pressure kept (unlike everything else in
      // this file, which only ever needed x/y) so a pressure-sensitive
      // canvas renderer (Editor mode) can feed these straight into
      // perfect-freehand. Each set rides along with the kind of tool that drew
      // it, since that decides which outline generator it belongs in (a
      // broad-nib calligraphy stroke is not a perfect-freehand one). Callers
      // that only need x/y (skeleton/SVG export) map both away.
      strokeSets: { points: StrokePoint[]; kind?: StrokeKind }[];
      // Closed Vector-tool shapes tagged into this glyph, untransformed like
      // strokeSets above. Renderers apply the same compile-time rule as
      // compileDocument(): with strokes present they punch holes, alone they
      // fill. Empty for every glyph drawn only with the pen.
      vectorShapes: VectorShape[];
      scale: number;
      offsetX: number;
      offsetY: number;
      advanceWidth: number;
      // How many raw text characters this one entry stands for — 1 for a
      // normal glyph, >1 when useLigatures substituted a multi-character
      // sequence (e.g. "fi") with a single ligature glyph. Callers that map
      // a caret/selection index (counted in raw characters) onto entries —
      // currently only EditorPanel.tsx — need this to stay aligned; callers
      // that only care about drawn width/position can ignore it.
      charLength: number;
    }
  | { kind: "space" | "missing"; advanceWidth: number; char: string };

export type TextLayout = {
  entries: LaidOutEntry[];
  width: number;
  height: number;
  missing: string[];
};

function bounds(points: [number, number][]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  if (points.length === 0) return null;
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

// Turns typed text into an ordered row of glyph placements, reusing the same
// two calibration strategies exportFont.ts's guideTransform/bboxTransform use
// — but without their y-flip: font space is y-up with baseline at 0, while
// here we stay in canvas/SVG y-down space throughout (the row is rendered
// straight into an <svg>, not compiled into a font), so a plain scale+
// translate is enough. No kerning — but with useLigatures on, a run of
// characters matching a tagged ligature's components (e.g. "f"+"i") is
// substituted with that glyph as a single entry, longest match first.
export function layoutText(
  text: string,
  glyphs: Glyph[],
  strokes: Stroke[],
  metrics: Metrics,
  useLigatures = false,
  // Vector-tool shapes (src/lib/vectorShapes.ts) tagged into glyphs. Optional
  // and last so the older 4/5-argument calls still compile — but a caller
  // that omits it renders a vector-only glyph as blank, which is exactly the
  // bug this parameter exists to fix, so pass it wherever glyphs are drawn.
  vectorShapes: VectorShape[] = []
): TextLayout {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const shapesById = new Map(vectorShapes.map((s) => [s.id, s]));
  // glyphs is append-only, so building the map in order already gives
  // "last tagged wins" for duplicate names — same tie-break GridCell.tsx uses
  // for overlapping strokes.
  const baseByName = new Map<string, Glyph>();
  for (const g of glyphs) if (g.kind === "base") baseByName.set(g.name, g);

  // Keyed by the literal typed sequence a ligature substitutes (its
  // components joined, e.g. "fi") — NOT the glyph's own free-typed name,
  // which is often a font-file convention like "f_i.liga" the typed text
  // never contains.
  const ligatureByKey = new Map<string, Glyph>();
  let maxLigatureLen = 1;
  if (useLigatures) {
    for (const g of glyphs) {
      if (g.kind !== "ligature" || !g.components || g.components.length < 2) continue;
      const key = g.components.join("");
      ligatureByKey.set(key, g);
      maxLigatureLen = Math.max(maxLigatureLen, g.components.length);
    }
  }

  const entries: LaidOutEntry[] = [];
  const missing = new Set<string>();
  let cursorX = 0;

  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const char = chars[i];
    if (char === " ") {
      entries.push({ kind: "space", advanceWidth: SPACE_ADVANCE, char });
      cursorX += SPACE_ADVANCE;
      i += 1;
      continue;
    }

    let charLength = 1;
    let glyph = baseByName.get(char);
    if (ligatureByKey.size > 0) {
      for (let len = Math.min(maxLigatureLen, chars.length - i); len >= 2; len--) {
        const candidate = ligatureByKey.get(chars.slice(i, i + len).join(""));
        if (candidate) {
          glyph = candidate;
          charLength = len;
          break;
        }
      }
    }

    if (!glyph) {
      missing.add(char);
      entries.push({ kind: "missing", advanceWidth: SPACE_ADVANCE, char });
      cursorX += SPACE_ADVANCE;
      i += 1;
      continue;
    }

    const strokeSets = glyph.strokeIds
      .map((id) => byId.get(id))
      .filter((s): s is Stroke => Boolean(s))
      .map((s) => ({ points: s.points, kind: s.kind }));
    // Only closed shapes are real geometry — an unfinished path has no fill,
    // same rule compileDocument() applies at export time.
    const glyphVectorShapes = (glyph.vectorShapeIds ?? [])
      .map((id) => shapesById.get(id))
      .filter((s): s is VectorShape => Boolean(s && s.closed));

    let scale: number;
    let offsetX: number;
    let offsetY: number;
    let advanceWidth: number;

    if (glyph.leftBearing != null && glyph.rightBearing != null && glyph.cellWidth && glyph.cellHeight) {
      // Grid View glyph: real calibration via the shared baseline/ascender
      // fractions and this glyph's own draggable bearings, resolved against
      // the cell's captured pixel size.
      const baselinePx = metrics.baseline * glyph.cellHeight;
      const ascenderPx = metrics.ascender * glyph.cellHeight;
      const leftPx = glyph.leftBearing * glyph.cellWidth;
      const rightPx = glyph.rightBearing * glyph.cellWidth;
      const span = baselinePx - ascenderPx;
      scale = span > 0 ? TARGET_CAP_HEIGHT / span : 1;
      offsetX = cursorX - leftPx * scale;
      offsetY = BASELINE_Y - baselinePx * scale;
      advanceWidth = Math.max((rightPx - leftPx) * scale, 1);
    } else {
      // Free-mode lasso-tagged glyph: no Grid guide data — rescale the
      // glyph's own drawn bounding box to a fixed height, ink-bottom on the
      // shared baseline. If there's no ink at all (shouldn't normally happen,
      // but a tagged glyph could in principle have lost its strokes), treat
      // the character as missing rather than crash on a null bbox.
      const bbox = bounds([
        ...strokeSets.flatMap((s) => s.points).map((p) => [p[0], p[1]] as [number, number]),
        // Vector shapes count as ink too — without them a glyph drawn ONLY
        // with the Vector tool has an empty bbox and gets treated as missing.
        ...glyphVectorShapes.flatMap((s) => flattenVectorShape(s)),
      ]);
      if (!bbox) {
        missing.add(char);
        entries.push({ kind: "missing", advanceWidth: SPACE_ADVANCE, char });
        cursorX += SPACE_ADVANCE;
        i += 1;
        continue;
      }
      const h = bbox.ymax - bbox.ymin;
      scale = h > 0 ? TARGET_CAP_HEIGHT / h : 1;
      offsetX = cursorX - bbox.xmin * scale + FALLBACK_SIDE_BEARING;
      offsetY = BASELINE_Y - bbox.ymax * scale;
      advanceWidth = (bbox.xmax - bbox.xmin) * scale + 2 * FALLBACK_SIDE_BEARING;
    }

    entries.push({
      kind: "glyph",
      glyph,
      strokeSets,
      vectorShapes: glyphVectorShapes,
      scale,
      offsetX,
      offsetY,
      advanceWidth,
      charLength,
    });
    cursorX += advanceWidth;
    i += charLength;
  }

  return {
    entries,
    width: cursorX,
    height: TARGET_CAP_HEIGHT * 1.4,
    missing: [...missing],
  };
}
