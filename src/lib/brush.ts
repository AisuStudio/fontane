import { getStroke } from "perfect-freehand";
import { buildPathSpace } from "./pathSpace";
import { seededRandom } from "./random";
import type { StrokePoint } from "./strokes";

// The one place a skeleton becomes ink.
//
// Until this module existed there was exactly one brush in the app, it just
// wasn't called that: getStroke(points, {size, thinning, smoothing,
// streamline}) — perfect-freehand's pressure envelope — duplicated across
// page.tsx, GridCell.tsx, EditorPanel.tsx and vf/VfLab.tsx. Everything here
// generalizes that single step into "applicator (Brush) applied to skeleton
// (Stroke.points) yields polygons", leaving the rest of the pipeline
// (unionOutlines -> outlineToPath -> contours, src/lib/contour.ts) untouched.
//
// Two properties this design deliberately keeps:
//
//  - Non-destructive. Stroke.points stays the raw skeleton, always. A brush
//    is resolved at render/compile time, never baked in, so switching brushes
//    restyles every existing letter instead of requiring a redraw.
//  - Deterministic. Every jitter comes from seededRandom(seedKey) keyed by
//    the stroke's own id, so the live canvas, the Editor preview and the
//    exported font all produce byte-identical geometry for the same input.
//    A brush that re-rolled its randomness per render would make a font
//    that's a different font every time it's compiled.

export type BrushKind = "freehand" | "nib" | "scatter";
export type NibShape = "ellipse" | "rect";
export type StampShape = "dot" | "square" | "triangle" | "dash";
// How each scattered stamp is oriented: along the path's own tangent, at one
// fixed page angle (engraving/hatching look), or randomly per stamp.
export type RotationMode = "follow" | "fixed" | "random";

// A swept pen nib — the broad-nib/pointed-pen model. Unlike the freehand
// envelope (whose width depends only on pressure), a nib's width depends on
// the DIRECTION of travel relative to the nib's own edge, which is what
// produces classic translation contrast: thick downstrokes, thin
// cross-strokes, from one uniform gesture.
export type NibParams = {
  // Page-absolute angle of the nib's long edge, in degrees. Not relative to
  // the tangent — that's the entire point; a nib rotating with the path
  // would just be a round pen.
  angle: number;
  // Short axis as a fraction of the long axis. 1 is a circle (no contrast),
  // ~0.15 is a broad calligraphy nib.
  ratio: number;
  shape: NibShape;
  // How much pen pressure scales the nib. 0 = ignore pressure entirely.
  pressure: number;
};

// Stamps repeated along the path — the stipple/texture family. Every length
// here is a multiple of the shared Size setting rather than an absolute px
// value, so a brush stays visually identical when applied at a different pen
// size (and so a published brush means the same thing in someone else's
// document).
export type ScatterParams = {
  stamp: StampShape;
  spacing: number; // gap between stamps, x Size
  size: number; // stamp diameter, x Size
  rotationMode: RotationMode;
  rotation: number; // degrees, added on top of the mode
  rotationJitter: number; // +/- degrees
  sizeJitter: number; // 0..1, fraction of stamp size
  offsetJitter: number; // 0..1, sideways scatter as a fraction of Size
  spacingJitter: number; // 0..1, fraction of spacing
  pressure: number; // how much pen pressure scales each stamp, 0 = not at all
};

export type BrushSettings = {
  kind: BrushKind;
  // Both parameter sets are kept regardless of which kind is active, so
  // toggling Nib -> Scatter -> Nib doesn't discard a tuned nib. (The
  // freehand brush has no params of its own — it reads the size/thinning/
  // smoothing/streamline settings that already existed.)
  nib: NibParams;
  scatter: ScatterParams;
};

export const DEFAULT_NIB: NibParams = { angle: 30, ratio: 0.18, shape: "ellipse", pressure: 0.3 };

export const DEFAULT_SCATTER: ScatterParams = {
  stamp: "dot",
  // Stamp slightly wider than the gap, so the default reads as a beaded line
  // of ink rather than a sparse dotted one — a starting point to open up,
  // not a texture that has to be found first.
  spacing: 0.5,
  size: 0.45,
  rotationMode: "follow",
  rotation: 0,
  rotationJitter: 0,
  sizeJitter: 0.25,
  offsetJitter: 0.3,
  spacingJitter: 0.25,
  pressure: 0.6,
};

export const DEFAULT_BRUSH: BrushSettings = { kind: "freehand", nib: DEFAULT_NIB, scatter: DEFAULT_SCATTER };

// The pen settings a brush is applied with. Identical to the object
// perfect-freehand was already being handed everywhere (page.tsx's
// optionsFor), plus the brush itself — so every existing call site keeps
// passing one options object, it just carries more now.
export type BrushOptions = {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  brush: BrushSettings;
};

export type BrushOutput = {
  // The ink. Possibly many polygons — a scatter brush emits one per stamp —
  // which overlap freely: the canvas fills them nonzero, and the export runs
  // them through unionOutlines() exactly like separately-drawn strokes.
  polygons: [number, number][][];
  // Whether these polygons want contour.ts's midpoint-quadratic smoothing.
  // True for a dense freehand outline (where it reproduces the drawn curve),
  // false for nib hulls and stamps — smoothing a square stamp would round
  // its corners off, and its corners are the whole reason it was chosen.
  smooth: boolean;
  // The plain freehand envelope of the same skeleton, regardless of brush.
  // Used for hit-testing and lasso selection ONLY: with a stipple brush the
  // ink is mostly holes, and requiring a click to land on one of a few
  // hundred scattered dots would make the stroke effectively unselectable.
  envelope: [number, number][];
};

const EMPTY_OUTPUT: BrushOutput = { polygons: [], smooth: true, envelope: [] };

// Runaway guard for the scatter brush: spacing can be dialled down far enough
// (and a skeleton dragged long enough) to ask for tens of thousands of
// stamps, which would lock the canvas mid-drag. The sidebar's ink budget
// readout shows the real count so hitting this is visible rather than silent.
const MAX_STAMPS = 2000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function perfectFreehandOptions(options: BrushOptions) {
  return {
    size: options.size,
    thinning: options.thinning,
    smoothing: options.smoothing,
    streamline: options.streamline,
  };
}

function freehandOutline(points: StrokePoint[], options: BrushOptions): [number, number][] {
  return getStroke(points, perfectFreehandOptions(options)) as [number, number][];
}

// Pen pressure folded into a size multiplier. `amount` 0 means pressure is
// ignored (multiplier 1); 1 means a zero-pressure sample collapses to
// nothing. Same shape as perfect-freehand's thinning, minus its sign
// convention — a brush has no use for the negative (inverted) half.
function pressureFactor(pressure: number, amount: number): number {
  return 1 - clamp01(amount) * (1 - clamp01(pressure));
}

// Andrew's monotone chain. Only used on the nib sweep, where the input is two
// convex nib outlines and the hull is the region the nib covers moving from
// one to the other.
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (input: [number, number][]) => {
    const chain: [number, number][] = [];
    for (const p of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop(); // shared with the other chain's first point
    return chain;
  };
  const hull = [...build(sorted), ...build(sorted.reverse())];
  // Degenerate input (every point collinear or coincident) collapses both
  // chains — hand the caller something it can still discard by length rather
  // than a silently empty polygon.
  return hull.length >= 3 ? hull : points;
}

const NIB_SEGMENTS = 14; // enough that an ellipse nib reads as round at drawing sizes

// The nib outline centred on the origin, already rotated to its page angle.
function nibPolygon(halfLong: number, halfShort: number, angle: number, shape: NibShape): [number, number][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (u: number, v: number): [number, number] => [u * cos - v * sin, u * sin + v * cos];
  if (shape === "rect") {
    return [place(-halfLong, -halfShort), place(halfLong, -halfShort), place(halfLong, halfShort), place(-halfLong, halfShort)];
  }
  const out: [number, number][] = [];
  for (let i = 0; i < NIB_SEGMENTS; i++) {
    const t = (i / NIB_SEGMENTS) * Math.PI * 2;
    out.push(place(Math.cos(t) * halfLong, Math.sin(t) * halfShort));
  }
  return out;
}

function translated(polygon: [number, number][], x: number, y: number): [number, number][] {
  return polygon.map(([px, py]) => [px + x, py + y] as [number, number]);
}

// Angle between two unit tangents, past which the inner side of the turn
// needs an explicit nib stamp to fill the wedge the swept quads leave open.
const CORNER_TANGENT_DOT = Math.cos(toRadians(8));

function applyNib(points: StrokePoint[], options: BrushOptions): [number, number][][] {
  const path = buildPathSpace(points, options.streamline);
  if (!path) return [];
  const nib = options.brush.nib;
  const angle = toRadians(nib.angle);
  const halfLong = Math.max(options.size, 1) / 2;
  const halfShort = halfLong * Math.max(clamp01(nib.ratio), 0.02);

  // The convex hull of two nib placements is EXACT for the straight sweep
  // between them (its sides are the common tangents), so the step size is
  // bounded by how far the skeleton curves between samples, not by how
  // smooth the sweep looks — which is why it can be this coarse. Sharper
  // direction changes get an explicit corner stamp below.
  const step = Math.max(1.5, halfLong * 0.5);
  const polygons: [number, number][][] = [];

  let prev = path.at(0);
  const startFactor = pressureFactor(prev.pressure, nib.pressure);
  let prevNib = nibPolygon(halfLong * startFactor, halfShort * startFactor, angle, nib.shape);
  // Start cap: the nib itself, so a tap (zero-length path) still leaves a
  // mark and a stroke start isn't sheared flat.
  polygons.push(translated(prevNib, prev.x, prev.y));

  for (let s = step; ; s += step) {
    const atEnd = s >= path.length;
    const sample = path.at(atEnd ? path.length : s);
    const factor = pressureFactor(sample.pressure, nib.pressure);
    const current = nibPolygon(halfLong * factor, halfShort * factor, angle, nib.shape);
    // The swept region between two nib placements is the convex hull of both
    // — exact for a convex nib, and cheap at this point count.
    polygons.push(
      convexHull([...translated(prevNib, prev.x, prev.y), ...translated(current, sample.x, sample.y)])
    );
    if (prev.tx * sample.tx + prev.ty * sample.ty < CORNER_TANGENT_DOT) {
      polygons.push(translated(current, sample.x, sample.y));
    }
    prev = sample;
    prevNib = current;
    if (atEnd) break;
  }
  // End cap, for the same reason as the start one.
  polygons.push(translated(prevNib, prev.x, prev.y));
  return polygons;
}

const STAMP_SEGMENTS = 12;

// Unit stamps: centred on the origin, sized to fit a diameter of 1, so the
// caller scales by one number. Kept as generated geometry rather than asset
// files on purpose — the moment stamps come from outside the app they need
// the whole import/sanitize/licence path a marketplace implies, and these
// four cover the texture families worth having before that exists.
function stampPolygon(shape: StampShape): [number, number][] {
  switch (shape) {
    case "square":
      return [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];
    case "triangle":
      return [
        [0, -0.5],
        [0.5, 0.4],
        [-0.5, 0.4],
      ];
    case "dash":
      return [
        [-0.5, -0.16],
        [0.5, -0.16],
        [0.5, 0.16],
        [-0.5, 0.16],
      ];
    default: {
      const out: [number, number][] = [];
      for (let i = 0; i < STAMP_SEGMENTS; i++) {
        const t = (i / STAMP_SEGMENTS) * Math.PI * 2;
        out.push([Math.cos(t) * 0.5, Math.sin(t) * 0.5]);
      }
      return out;
    }
  }
}

function applyScatter(points: StrokePoint[], options: BrushOptions, seedKey: string): [number, number][][] {
  const path = buildPathSpace(points, options.streamline);
  if (!path) return [];
  const sc = options.brush.scatter;
  const rng = seededRandom(`${seedKey}:scatter`);
  const unit = stampPolygon(sc.stamp);
  const baseSize = Math.max(options.size * sc.size, 0.5);
  // Never let jitter drive the step to zero or negative — that's an infinite
  // loop, not a dense texture.
  const baseStep = Math.max(options.size * sc.spacing, 0.5);

  const polygons: [number, number][][] = [];
  let s = 0;
  while (s <= path.length && polygons.length < MAX_STAMPS) {
    const sample = path.at(s);
    const factor = pressureFactor(sample.pressure, sc.pressure);
    const size = baseSize * factor * (1 + (rng() * 2 - 1) * sc.sizeJitter);
    const offset = (rng() * 2 - 1) * sc.offsetJitter * options.size;
    const angle =
      sc.rotationMode === "follow"
        ? Math.atan2(sample.ty, sample.tx) + toRadians(sc.rotation)
        : sc.rotationMode === "random"
          ? rng() * Math.PI * 2
          : toRadians(sc.rotation);
    const jittered = angle + toRadians((rng() * 2 - 1) * sc.rotationJitter);
    const cos = Math.cos(jittered);
    const sin = Math.sin(jittered);
    const cx = sample.x + sample.nx * offset;
    const cy = sample.y + sample.ny * offset;
    if (size > 0.05) {
      polygons.push(
        unit.map(([ux, uy]) => {
          const sx = ux * size;
          const sy = uy * size;
          return [cx + sx * cos - sy * sin, cy + sx * sin + sy * cos] as [number, number];
        })
      );
    }
    const step = Math.max(baseStep * (1 + (rng() * 2 - 1) * sc.spacingJitter), 0.5);
    // A zero-length path (a tap) still gets its one stamp from the pass
    // above; break rather than loop forever on s stuck at 0.
    if (path.length === 0) break;
    s += step;
  }
  return polygons;
}

// Just the hit-test envelope, skipping the brush geometry entirely. Grid's
// cells recompute this per stroke on every pointer move (they cache no
// outlines, unlike Free's canvas), and building a few hundred nib hulls or
// stipple stamps only to throw them away and test against the envelope would
// put all of that in the drag path.
export function brushEnvelope(points: StrokePoint[], options: BrushOptions): [number, number][] {
  return points.length === 0 ? [] : freehandOutline(points, options);
}

// Applies `options.brush` to a skeleton. seedKey should be stable for the
// life of the stroke — the stroke's own id everywhere it has one — so the
// same stroke scatters identically on every render and in every export.
export function applyBrush(points: StrokePoint[], options: BrushOptions, seedKey: string): BrushOutput {
  if (points.length === 0) return EMPTY_OUTPUT;
  const envelope = freehandOutline(points, options);
  switch (options.brush.kind) {
    case "nib":
      return { polygons: applyNib(points, options), smooth: false, envelope };
    case "scatter":
      return { polygons: applyScatter(points, options, seedKey), smooth: false, envelope };
    default:
      return { polygons: envelope.length >= 3 ? [envelope] : [], smooth: true, envelope };
  }
}

// Total point count across a brush output — the number that actually matters
// for the exported font (every one of these becomes a point in the glyf
// table), shown live in the sidebar so a stipple brush's cost is visible
// before it turns into a 2 MB .otf.
export function inkPointCount(output: BrushOutput): number {
  let total = 0;
  for (const polygon of output.polygons) total += polygon.length;
  return total;
}
