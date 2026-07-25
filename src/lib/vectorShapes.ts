// True Bezier vector shapes — the Vector tool's data model, deliberately
// separate from Stroke (raw pressure/point capture for perfect-freehand).
// Anchors carry independent in/out control handles, same as a real
// Illustrator/Figma pen tool; undefined handleIn/handleOut means a straight
// (corner) segment on that side. See contour.ts's flattenVectorShape() for
// how this gets sampled down to a plain polygon for the union/export
// pipeline — the anchors+handles here are only ever the editable source.
export type BezierPoint = { x: number; y: number };

// `smooth` is Illustrator's smooth-vs-corner distinction: on a smooth point
// the two handles stay collinear through the anchor (dragging one swings the
// other), on a corner they move independently. Optional and unversioned, same
// as every other field added here after the fact — shapes drawn before it
// existed simply have it undefined and get classified from their geometry by
// isSmoothAnchor() below, so there's nothing to migrate.
export type BezierAnchor = {
  x: number;
  y: number;
  handleIn?: BezierPoint;
  handleOut?: BezierPoint;
  smooth?: boolean;
};

// ~7°. Handles dragged out by hand are never EXACTLY collinear (the symmetric
// drag that used to be the only way to make a curve point wrote both sides
// from the same pointer position, so those are exact — but a later single-side
// nudge, or a round-trip through the Grid's per-glyph anchor space, isn't), so
// the fallback classifier needs a little slack before it calls a point a cusp.
const SMOOTH_ANGLE_TOLERANCE = 0.12;

// Is this a smooth (tangent-continuous) point? The stored flag wins where it
// exists; otherwise fall back to the geometry — two handles pointing in
// near-opposite directions away from the anchor ARE a smooth point, whatever
// their lengths, which is exactly what the old symmetric drag-out produced.
// Anything with fewer than two handles is a corner: there's no second tangent
// to keep continuous.
export function isSmoothAnchor(a: BezierAnchor): boolean {
  if (a.smooth !== undefined) return a.smooth;
  if (!a.handleIn || !a.handleOut) return false;
  const inX = a.handleIn.x - a.x;
  const inY = a.handleIn.y - a.y;
  const outX = a.handleOut.x - a.x;
  const outY = a.handleOut.y - a.y;
  const inLen = Math.hypot(inX, inY);
  const outLen = Math.hypot(outX, outY);
  if (inLen === 0 || outLen === 0) return false;
  // Opposed directions put the normalized dot product at -1, so the test is
  // "within tolerance of -1" rather than the usual "close to +1".
  const dot = (inX * outX + inY * outY) / (inLen * outLen);
  return dot <= -Math.cos(SMOOTH_ANGLE_TOLERANCE);
}

// Illustrator's tangent continuity, the half of smooth-point behavior that
// isn't just bookkeeping: dragging one handle swings the OPPOSITE one around
// the anchor to stay collinear, while that handle keeps its own length.
// Mirroring the dragged length instead (what a naive "smooth point" does)
// would silently rewrite the curvature of the neighbouring segment every time
// you touched this one. No-op when there's nothing to swing (no opposite
// handle) or no direction to swing to (a handle collapsed onto its anchor).
export function alignOppositeHandle(anchor: BezierAnchor, which: "handleIn" | "handleOut") {
  const other = which === "handleIn" ? "handleOut" : "handleIn";
  const dragged = anchor[which];
  const opposite = anchor[other];
  if (!dragged || !opposite) return;
  const dx = dragged.x - anchor.x;
  const dy = dragged.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const oppositeLen = Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
  anchor[other] = {
    x: anchor.x - (dx / len) * oppositeLen,
    y: anchor.y - (dy / len) * oppositeLen,
  };
}

// Illustrator's Shift constraint: snap the direction from origin (ox, oy) to
// (x, y) onto the nearest multiple of 45°, preserving the distance. Pure —
// both canvases apply it to whatever position is being dragged (a handle
// around its anchor, a Shift-clicked new anchor around the previous one)
// without caring which.
export function constrainTo45(ox: number, oy: number, x: number, y: number): BezierPoint {
  const dx = x - ox;
  const dy = y - oy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x, y };
  const step = Math.PI / 4;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: ox + Math.cos(snapped) * len, y: oy + Math.sin(snapped) * len };
}

// Glyphs' double-click parity: flip an anchor between smooth and corner in
// place. A smooth point simply loses tangent continuity (handles stay where
// they are, they just move independently from now on); a corner that still
// has BOTH handles becomes smooth again, swinging handleIn collinear to
// handleOut while keeping its own length (alignOppositeHandle — the same
// tangent rule a smooth-point drag enforces). A corner without both handles
// is left alone — pulling handles out of nothing stays the Convert tool's
// job. Returns whether anything changed, so callers know whether to persist.
export function toggleAnchorSmooth(anchor: BezierAnchor): boolean {
  if (isSmoothAnchor(anchor)) {
    anchor.smooth = false;
    return true;
  }
  if (!anchor.handleIn || !anchor.handleOut) return false;
  anchor.smooth = true;
  alignOppositeHandle(anchor, "handleOut");
  return true;
}

export type VectorShape = {
  id: string;
  anchors: BezierAnchor[];
  closed: boolean;
  createdAt: number;
};

const STORAGE_KEY = "fontane.vectorShapes.v1";

export function loadVectorShapes(): VectorShape[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVectorShapes(shapes: VectorShape[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes));
}

export function clearVectorShapes() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
