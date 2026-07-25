import type { StrokePoint } from "./strokes";

// A broad-nib calligraphy pen: an oval held at a FIXED angle and dragged along
// the path. Everything about the letter's contrast — thick downstrokes, hairline
// cross-strokes — falls out of that one constraint, which is why this tool
// deliberately ignores pressure (unlike the pen/brush, which route through
// perfect-freehand's thinning). Width comes from the direction you move, not
// from how hard you press.
export type Nib = {
  // Long axis of the oval, in canvas px — the widest the stroke can ever get.
  size: number;
  // Short axis as a fraction of the long one: 1 is a round nib (no contrast at
  // all, a monoline), and the closer to 0 the sharper the blade, so the
  // hairline direction gets genuinely thin.
  ratio: number;
  // How far the long axis is tilted, in degrees, counter-clockwise as seen on
  // screen. 0 lays the nib flat (thin verticals, thick horizontals); the
  // classic broad-pen hands sit somewhere around 30–45.
  angle: number;
};

export const DEFAULT_NIB: Nib = { size: 26, ratio: 0.2, angle: 40 };

// Sampling of the two half-oval end caps. Both caps are real ellipse arcs (the
// swept region genuinely ends in half a nib), so a handful of segments is
// enough — outlineToPath's midpoint-quadratic smoothing rounds the rest.
const CAP_SEGMENTS = 10;
// Points closer together than this contribute no direction, only noise —
// pointer events fire far faster than the hand actually moves.
const MIN_STEP = 0.75;

type Axes = { a: number; b: number; cos: number; sin: number };

function axesFor(nib: Nib): Axes {
  const a = Math.max(nib.size, 0.2) / 2;
  const b = a * Math.min(Math.max(nib.ratio, 0.02), 1);
  // Canvas y grows downward, so an on-screen counter-clockwise tilt is a
  // negative rotation in the raw coordinate system.
  const theta = (-nib.angle * Math.PI) / 180;
  return { a, b, cos: Math.cos(theta), sin: Math.sin(theta) };
}

// The point of the nib oval furthest along direction (ux, uy) — its "support
// point". Offsetting each path sample by the support points in ±normal and
// joining them up traces the exact boundary of the swept ink (the Minkowski
// sum of the path and the oval), which is what makes this a nib rather than a
// variable-width outline approximating one.
function support(ux: number, uy: number, { a, b, cos, sin }: Axes): [number, number] {
  // Rotate the query direction into the oval's own frame, take the support
  // point of an axis-aligned ellipse there, rotate the answer back out.
  const vx = cos * ux + sin * uy;
  const vy = -sin * ux + cos * uy;
  const len = Math.hypot(a * vx, b * vy);
  if (len === 0) return [0, 0];
  const qx = (a * a * vx) / len;
  const qy = (b * b * vy) / len;
  return [cos * qx - sin * qy, sin * qx + cos * qy];
}

// The nib itself as a closed polygon, centered on (cx, cy) — the shape a
// single tap leaves behind, and what the settings panel draws as its preview.
export function nibPolygon(cx: number, cy: number, nib: Nib, segments = 32): [number, number][] {
  const { a, b, cos, sin } = axesFor(nib);
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const qx = a * Math.cos(t);
    const qy = b * Math.sin(t);
    ring.push([cx + cos * qx - sin * qy, cy + sin * qx + cos * qy]);
  }
  return ring;
}

// Drops samples too close to their predecessor (see MIN_STEP), then runs two
// light 1-2-1 passes over what's left with the endpoints pinned. The stored
// stroke keeps its raw points either way — Nudge and the skeleton export still
// treat them as a true centerline, exactly like a pen stroke's — this only
// steadies the direction estimates below, where raw pointer jitter would
// otherwise flip the normal back and forth and scallop the edges.
function centerline(points: StrokePoint[]): [number, number][] {
  const kept: [number, number][] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) continue;
    kept.push([p[0], p[1]]);
  }
  if (kept.length < 3) return kept;
  let current = kept;
  for (let pass = 0; pass < 2; pass++) {
    const next: [number, number][] = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      next.push([
        (current[i - 1][0] + 2 * current[i][0] + current[i + 1][0]) / 4,
        (current[i - 1][1] + 2 * current[i][1] + current[i + 1][1]) / 4,
      ]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

// Unit travel direction at each sample: a central difference in the middle,
// one-sided at the two ends. A zero-length difference (duplicate points that
// survived smoothing) inherits the previous direction rather than collapsing
// the offset to nothing.
function directions(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let previous: [number, number] = [1, 0];
  for (let i = 0; i < pts.length; i++) {
    const from = pts[Math.max(0, i - 1)];
    const to = pts[Math.min(pts.length - 1, i + 1)];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) previous = [dx / len, dy / len];
    out.push(previous);
  }
  return out;
}

// Half-oval cap around `center`, from the support point in direction `from`
// round to the support point in the opposite direction. Both caps sweep the
// same way (clockwise in raw coordinates): at the end of a stroke the outgoing
// normal turns through the travel direction to reach its opposite, and at the
// start the incoming normal turns through the reversed travel direction — the
// cross product is -1 in both cases, so no per-cap sign test is needed.
function cap(center: [number, number], from: [number, number], axes: Axes): [number, number][] {
  const arc: [number, number][] = [];
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const phi = (i / CAP_SEGMENTS) * Math.PI;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const ux = from[0] * c + from[1] * s;
    const uy = -from[0] * s + from[1] * c;
    const [ox, oy] = support(ux, uy, axes);
    arc.push([center[0] + ox, center[1] + oy]);
  }
  return arc;
}

// The filled outline of one calligraphy stroke, in the same closed-polygon
// form perfect-freehand's getStroke hands back — so every consumer (canvas
// fill, hit-testing, unionOutlines at export time) treats the two alike.
export function calligraphyOutline(points: StrokePoint[], nib: Nib): [number, number][] {
  const axes = axesFor(nib);
  const pts = centerline(points);
  if (pts.length === 0) return [];
  // A tap, or a scribble too small to have a direction, is just the nib
  // itself — the mark the pen leaves without moving.
  if (pts.length === 1) return nibPolygon(pts[0][0], pts[0][1], nib);

  const dirs = directions(pts);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    // The oval is centrally symmetric, so one support point serves both
    // edges — the far edge is simply its negation.
    const [ox, oy] = support(-dirs[i][1], dirs[i][0], axes);
    left.push([pts[i][0] + ox, pts[i][1] + oy]);
    right.push([pts[i][0] - ox, pts[i][1] - oy]);
  }

  const last = pts.length - 1;
  const endNormal: [number, number] = [-dirs[last][1], dirs[last][0]];
  const startNormal: [number, number] = [dirs[0][1], -dirs[0][0]];
  return [
    ...left,
    ...cap(pts[last], endNormal, axes),
    ...right.reverse(),
    ...cap(pts[0], startNormal, axes),
  ];
}
