import polygonClipping, { type Polygon, type MultiPolygon } from "polygon-clipping";
import type { VectorShape, BezierAnchor, BezierPoint } from "./vectorShapes";
import { calligraphyOutline } from "./calligraphy";
import type { StrokePoint } from "./strokes";

export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

// Same topology as the canvas fill: curve through each outline point to the midpoint
// with its neighbor. Keeping this as the one place that logic lives means the SVG
// export always matches what's drawn on screen.
export function outlineToPath(outline: [number, number][]): PathCommand[] {
  if (outline.length < 3) return [];
  const commands: PathCommand[] = [{ type: "M", x: outline[0][0], y: outline[0][1] }];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    commands.push({ type: "Q", cx: x0, cy: y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  commands.push({ type: "Z" });
  return commands;
}

// The raw pen path (not the filled perfect-freehand outline) as an OPEN path —
// a "skeleton"/centerline a type designer can hand to Glyphs.app's Offset
// Curve filter (or similar) to build a proper stroke-width outline manually,
// instead of relying on our own filled-outline export. Same midpoint-
// quadratic smoothing style as outlineToPath, just not wrapped into a closed
// ring: starts exactly at the first point and ends exactly at the last.
export function skeletonToPath(points: [number, number][]): PathCommand[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return [
      { type: "M", x: points[0][0], y: points[0][1] },
      { type: "L", x: points[1][0], y: points[1][1] },
    ];
  }
  const commands: PathCommand[] = [{ type: "M", x: points[0][0], y: points[0][1] }];
  for (let i = 0; i < points.length - 2; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    commands.push({ type: "Q", cx: x0, cy: y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  const secondLast = points[points.length - 2];
  const last = points[points.length - 1];
  commands.push({ type: "Q", cx: secondLast[0], cy: secondLast[1], x: last[0], y: last[1] });
  return commands;
}

// The same closed ring as outlineToPath, with straight edges instead of
// midpoint quadratics. Freehand outlines are dense point clouds where the
// quadratic smoothing reproduces the drawn curve; nib hulls and scatter
// stamps are exact low-point-count polygons where it does the opposite —
// running a square stamp through outlineToPath rounds off the corners that
// were the entire reason for picking that stamp. See BrushOutput.smooth in
// src/lib/brush.ts, which is what decides between the two.
export function outlineToSharpPath(outline: [number, number][]): PathCommand[] {
  if (outline.length < 3) return [];
  const commands: PathCommand[] = [{ type: "M", x: outline[0][0], y: outline[0][1] }];
  for (let i = 1; i < outline.length; i++) commands.push({ type: "L", x: outline[i][0], y: outline[i][1] });
  commands.push({ type: "Z" });
  return commands;
}

// Shoelace formula. Used to drop degenerate slivers polygon-clipping can
// produce at exact intersection points (floating-point noding artifacts —
// near-zero-area rings, not real geometry).
function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

const MIN_RING_AREA = 0.5; // sq. canvas px — real strokes are always far larger than this

// Strokes making up one glyph are drawn independently and can overlap (e.g.
// the crossbar and stem of a "t"). Feeding each stroke's outline into the
// font as its own separate contour renders fine on canvas (nonzero fill
// handles overlaps invisibly), but overlapping/self-intersecting contours can
// glitch in stricter font rasterizers — this merges them into clean,
// non-overlapping polygons first. Output rings may include holes (e.g. a
// ring-shaped union); each ring is still just a contour to run through
// outlineToPath — the winding direction polygon-clipping assigns each ring
// is what makes nonzero-fill render holes correctly.
export function unionOutlines(outlines: [number, number][][]): [number, number][][] {
  const polygons: Polygon[] = outlines.filter((o) => o.length >= 3).map((o) => [o]);
  if (polygons.length === 0) return [];
  const merged: MultiPolygon = polygonClipping.union(polygons[0], ...polygons.slice(1));
  return merged.flat().filter((ring) => ringArea(ring) > MIN_RING_AREA);
}

// Combines a glyph's own Vector-tool shapes with an even-odd (XOR) rule
// instead of a union: a shape drawn INSIDE another cuts a counter out of it,
// which is how you draw a "B" or an "O" as pure vector outlines. Union would
// swallow the inner shape and compile the letter as a solid blob. Winding
// direction is irrelevant here, so nested shapes work whichever way round
// they were drawn.
export function xorOutlines(outlines: [number, number][][]): [number, number][][] {
  const polygons: Polygon[] = outlines.filter((o) => o.length >= 3).map((o) => [o]);
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons[0].filter((ring) => ringArea(ring) > MIN_RING_AREA);
  const merged: MultiPolygon = polygonClipping.xor(polygons[0], ...polygons.slice(1));
  return merged.flat().filter((ring) => ringArea(ring) > MIN_RING_AREA);
}

// Cuts `negative` out of `positive` — used for the Vector tool's default
// "shapes punch a hole" behavior (see compileDocument() in page.tsx). Both
// arguments are expected to already be unionOutlines()'d among themselves;
// this only combines the two groups. Falls back to returning `positive`
// untouched when there's nothing to subtract, rather than erroring on an
// empty clip geometry.
export function subtractOutlines(
  positive: [number, number][][],
  negative: [number, number][][]
): [number, number][][] {
  const positivePolys: Polygon[] = positive.filter((o) => o.length >= 3).map((o) => [o]);
  const negativePolys: Polygon[] = negative.filter((o) => o.length >= 3).map((o) => [o]);
  if (positivePolys.length === 0) return [];
  if (negativePolys.length === 0) return positive.filter((o) => o.length >= 3);
  const result: MultiPolygon = polygonClipping.difference(positivePolys, negativePolys);
  return result.flat().filter((ring) => ringArea(ring) > MIN_RING_AREA);
}

// Exported so page.tsx's Vector-tool insertion hit-test can sample the same
// true curve this flattening uses, rather than a straight-line approximation
// (see findInsertionRank's stroke-anchor equivalent for why that matters).
export function cubicPoint(p0: BezierPoint, c1: BezierPoint, c2: BezierPoint, p1: BezierPoint, t: number): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0.x + b * c1.x + c * c2.x + d * p1.x, a * p0.y + b * c1.y + c * c2.y + d * p1.y];
}

// Splits one segment of a VectorShape at parameter t and returns the shape's
// new anchor list — a De Casteljau subdivision, which is the whole point:
// the two halves it produces reproduce the original curve EXACTLY, so adding
// a point doesn't move the outline by a hair. That only works if the
// neighbours' adjacent handles are adjusted too (both shrink toward the
// split), which is why this returns a whole anchors array rather than just
// the new anchor. Illustrator's Add Anchor Point tool and the Pen's own
// contextual insert both go through here.
//
// A straight segment (no handle on either end) stays straight: a plain corner
// at the split point is already exact there, and manufacturing zero-length
// handles for it would only add noise to the stored shape.
export function splitVectorSegment(shape: VectorShape, segmentIndex: number, t: number): BezierAnchor[] {
  const anchors = shape.anchors;
  const i = segmentIndex;
  const j = (i + 1) % anchors.length;
  const p0 = anchors[i];
  const p1 = anchors[j];
  const lerp = (a: BezierPoint, b: BezierPoint): BezierPoint => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  // A control point that lands on its own anchor is no handle at all — drop
  // it rather than storing a zero-length one (see flattenVectorShape's
  // straight-segment shortcut, which keys off handles being absent).
  const kept = (p: BezierPoint, anchor: BezierPoint): BezierPoint | undefined =>
    Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1e-6 ? undefined : p;
  const spliced = (mid: BezierAnchor, leftOut?: BezierPoint, rightIn?: BezierPoint): BezierAnchor[] => {
    const next = anchors.slice();
    next[i] = { ...p0, handleOut: leftOut };
    next[j] = { ...p1, handleIn: rightIn };
    // i + 1 also lands correctly when j wrapped to 0 on a closed shape: the
    // new anchor belongs at the end of the list there, between last and first.
    next.splice(i + 1, 0, mid);
    return next;
  };

  if (!p0.handleOut && !p1.handleIn) return spliced({ ...lerp(p0, p1) });

  const c1 = p0.handleOut ?? { x: p0.x, y: p0.y };
  const c2 = p1.handleIn ?? { x: p1.x, y: p1.y };
  // One De Casteljau level per line: the intermediate points ARE the control
  // points of the two halves, and the last one is the split point itself.
  const a = lerp(p0, c1);
  const b = lerp(c1, c2);
  const c = lerp(c2, p1);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const split = lerp(d, e);
  // d / split / e are collinear by construction (split is the midpoint-by-t of
  // d and e), so the inserted anchor is genuinely a smooth point, not just a
  // point we're labelling as one.
  return spliced({ ...split, handleIn: d, handleOut: e, smooth: true }, kept(a, p0), kept(c, p1));
}

// Dense-samples the Vector tool's true cubic Bezier anchors into a plain
// polygon — the same [number,number][] shape unionOutlines/outlineToPath
// already consume for freehand strokes. One-way and compile-time-only: the
// editable anchors+handles themselves only ever live in the VectorShape
// source (src/lib/vectorShapes.ts), same relationship FFF's raw stroke
// points have to compileDocument()'s unioned output. A segment with no
// handle on either end is a straight line (no sampling needed).
export function flattenVectorShape(shape: VectorShape, segmentsPerCurve = 24): [number, number][] {
  if (shape.anchors.length < 2) return [];
  const points: [number, number][] = [[shape.anchors[0].x, shape.anchors[0].y]];
  const segmentCount = shape.closed ? shape.anchors.length : shape.anchors.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = shape.anchors[i];
    const p1 = shape.anchors[(i + 1) % shape.anchors.length];
    if (!p0.handleOut && !p1.handleIn) {
      points.push([p1.x, p1.y]);
      continue;
    }
    const c1 = p0.handleOut ?? { x: p0.x, y: p0.y };
    const c2 = p1.handleIn ?? { x: p1.x, y: p1.y };
    for (let s = 1; s <= segmentsPerCurve; s++) {
      points.push(cubicPoint(p0, c1, c2, p1, s / segmentsPerCurve));
    }
  }
  return points;
}

// Per-point local-tangent normal offset of a CLOSED, already-deduped ring —
// cyclic (no start/end caps, since there are no ends). Used by
// vectorShapeStrokeOutline below to build the outer/inner boundary of a
// closed path's stroke; a tight concave corner's inner offset can fold back
// on itself locally, which is fine here because the caller only ever feeds
// this into subtractOutlines(), whose polygon-clipping engine resolves that
// robustly rather than needing the offset ring to already be simple.
function offsetClosedRing(points: [number, number][], radius: number): [number, number][] {
  const n = points.length;
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ring.push([points[i][0] + nx * radius, points[i][1] + ny * radius]);
  }
  return ring;
}

// A closed ring's flattened point list ends where it started (see
// flattenVectorShape's wraparound on the final segment) — collapse that back
// down to one instance, and any other back-to-back duplicates dense curve
// sampling can produce, so offsetClosedRing's neighbour-based tangent never
// divides by a zero-length gap.
function dedupeRing(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) out.pop();
  }
  return out;
}

// A constant-width stroke along a VectorShape's true curve, in the exported-
// glyph polygon shape (one or more rings) — the geometry both the live
// canvas ink pass and compileDocument's export share, so they never drift
// apart. An OPEN path reuses calligraphyOutline with a ratio-1 ("circular")
// nib: that's already an exact Minkowski-sum-with-a-disk stroke, round caps
// and joins included, so there's no new sweep math to write. A CLOSED path
// has no ends to cap — instead its outer and inner offset boundaries (see
// offsetClosedRing) are cut apart with the same polygon-clipping-backed
// subtractOutlines() the rest of the export pipeline already trusts, which
// is what makes a tight inner corner safe even though the naive offset ring
// itself can be locally non-simple there.
export function vectorShapeStrokeOutline(
  shape: VectorShape,
  width: number,
  segmentsPerCurve = 24
): [number, number][][] {
  const points = flattenVectorShape(shape, segmentsPerCurve);
  if (points.length < 2) return [];
  if (!shape.closed) {
    const tapped: StrokePoint[] = points.map(([x, y]) => [x, y, 1]);
    const outline = calligraphyOutline(tapped, { size: width, ratio: 1, angle: 0 });
    return outline.length >= 3 ? [outline] : [];
  }
  const ring = dedupeRing(points);
  if (ring.length < 3) return [];
  const radius = width / 2;
  // Which offset direction is "outward" depends on the ring's own winding
  // order, which a hand-drawn path can go either way — rather than assuming
  // one, offset both ways and let enclosed area (always larger outward,
  // smaller inward, regardless of winding) decide which is which.
  const a = offsetClosedRing(ring, radius);
  const b = offsetClosedRing(ring, -radius);
  const [outer, inner] = ringArea(a) >= ringArea(b) ? [a, b] : [b, a];
  return subtractOutlines([outer], [inner]);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pathToSvgD(commands: PathCommand[]): string {
  return commands
    .map((c) => {
      if (c.type === "M") return `M${round(c.x)} ${round(c.y)}`;
      if (c.type === "L") return `L${round(c.x)} ${round(c.y)}`;
      if (c.type === "Q") return `Q${round(c.cx)} ${round(c.cy)} ${round(c.x)} ${round(c.y)}`;
      return "Z";
    })
    .join(" ");
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
