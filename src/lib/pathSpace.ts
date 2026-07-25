import type { StrokePoint } from "./strokes";

// Arc-length parametrization of a skeleton (a raw pen path). Every brush that
// isn't perfect-freehand needs the same three things at an arbitrary position
// along the path — where am I, which way am I pointing, how hard was the pen
// pressed there — and needs them keyed by DISTANCE, not by point index: a
// stipple spaced "every 8px" has to stay evenly spaced whether the pointer
// samples that stretch densely (slow drag) or sparsely (fast flick). Point
// indices carry that sampling bias, arc length doesn't.
//
// This is deliberately the only place that turns raw StrokePoints into a
// continuous path. src/lib/brush.ts consumes it; nothing else should need to.
export type PathSample = {
  x: number;
  y: number;
  // Unit tangent (direction of travel) and unit normal. Canvas space is
  // y-down, so the normal (-ty, tx) points to the LEFT of travel visually —
  // which side is which only matters for asymmetric brushes, and none of
  // the current ones are, but the convention is fixed here so a future one
  // doesn't have to guess.
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  pressure: number;
  s: number; // arc length from the start, in canvas px
};

export type PathSpace = {
  length: number; // total arc length in canvas px; 0 for a single-point tap
  at(s: number): PathSample; // s outside [0, length] is clamped, never extrapolated
};

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// perfect-freehand's own streamline filter, reimplemented here because we
// need it applied to the SKELETON (before sampling) rather than to an outline
// — getStroke() does this internally and never hands the smoothed centerline
// back out. Same formula as its getStrokePoints so a nib stroke and a
// freehand stroke drawn with the same Streamline setting follow the same
// underlying curve, instead of two different smoothings of one gesture.
export function streamlinePoints(points: StrokePoint[], streamline: number): StrokePoint[] {
  if (points.length < 2 || streamline <= 0) return points;
  const t = 0.15 + (1 - clamp01(streamline)) * 0.85;
  const out: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    // Pressure is carried through unfiltered: it's already a physical
    // measurement per sample, and smoothing it would flatten exactly the
    // accents a pressure-driven brush exists to reproduce.
    out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t, cur[2]]);
  }
  return out;
}

const EPSILON = 1e-6;

// Returns null only for an empty input — a single point (a tap) still gets a
// valid zero-length PathSpace, so a scatter brush can put one stamp there
// instead of the stroke silently vanishing.
export function buildPathSpace(rawPoints: StrokePoint[], streamline = 0): PathSpace | null {
  if (rawPoints.length === 0) return null;
  const smoothed = streamlinePoints(rawPoints, streamline);

  // Drop repeated samples. A zero-length segment has no direction, so leaving
  // one in would hand out a NaN tangent at exactly that arc position — and a
  // pointer held still for one frame produces them routinely.
  const pts: StrokePoint[] = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(smoothed[i][0] - prev[0], smoothed[i][1] - prev[1]) > EPSILON) pts.push(smoothed[i]);
  }

  if (pts.length === 1) {
    const [x, y, pressure] = pts[0];
    const only: PathSample = { x, y, tx: 1, ty: 0, nx: 0, ny: 1, pressure, s: 0 };
    return { length: 0, at: () => only };
  }

  // cumulative[i] is the arc length from the start up to pts[i].
  const cumulative: number[] = new Array(pts.length);
  cumulative[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const length = cumulative[cumulative.length - 1];

  function segmentAt(s: number): number {
    // Binary search for the last index whose cumulative length is <= s.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumulative[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    // The final point is the END of the last segment, never the start of a
    // new one — clamp so at(length) interpolates within the last segment.
    return Math.min(lo, pts.length - 2);
  }

  return {
    length,
    at(s: number): PathSample {
      const clamped = s < 0 ? 0 : s > length ? length : s;
      const i = segmentAt(clamped);
      const a = pts[i];
      const b = pts[i + 1];
      const segLength = cumulative[i + 1] - cumulative[i];
      const t = segLength > EPSILON ? (clamped - cumulative[i]) / segLength : 0;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      return {
        x: a[0] + dx * t,
        y: a[1] + dy * t,
        tx,
        ty,
        nx: -ty,
        ny: tx,
        pressure: a[2] + (b[2] - a[2]) * t,
        s: clamped,
      };
    },
  };
}
