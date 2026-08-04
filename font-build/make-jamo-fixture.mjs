// Generates a synthetic 24-jamo document so the Hangul composition pipeline
// can be run and looked at before anyone has drawn a single stroke.
//
// These are crude geometric approximations — straight bars and one circle, no
// handwriting, no calligraphic weight. That's the point: it isolates the
// LAYOUT question (are the six syllable classes proportioned correctly? does
// the batchim sit right? do compound vowels collide?) from the AESTHETIC
// question (does composed handwriting look charming or mechanical), which
// only real drawn jamo can answer. Same role as make-vf-fixture.mjs.
//
// Usage: node font-build/make-jamo-fixture.mjs > font-build/fixtures/jamo-synthetic.json

const BOX = 100; // shapes are authored in a 0..100 box, y down
const W = 8; // stroke thickness

// One rectangle per segment. Every rectangle is built in the same handedness
// relative to its segment direction, so all contours share a winding and
// TrueType's nonzero fill unions the overlaps at the joins for free — no path
// booleans needed for a fixture.
function strokePolyline(points, width = W) {
  const half = width / 2;
  const contours = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    // Normal, plus an extension along the segment so consecutive segments
    // overlap at the corner instead of leaving a notch.
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    const ex = (dx / len) * half, ey = (dy / len) * half;
    const ax = x0 - ex, ay = y0 - ey, bx = x1 + ex, by = y1 + ey;
    contours.push([
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ]);
  }
  return contours;
}

// Outer ring clockwise, inner ring counter-clockwise — opposite windings are
// what make the middle a hole rather than solid ink.
function ring(cx, cy, radius, width = W, steps = 32) {
  const outer = [], inner = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    outer.push([cx + Math.cos(a) * (radius + width / 2), cy + Math.sin(a) * (radius + width / 2)]);
    inner.unshift([cx + Math.cos(a) * (radius - width / 2), cy + Math.sin(a) * (radius - width / 2)]);
  }
  return [outer, inner];
}

const P = (...points) => strokePolyline(points);

// The 24 basics. Shapes follow the standard skeletons; proportions are
// eyeballed, which is fine for a layout probe.
const JAMO = {
  "ㄱ": [...P([12, 16], [88, 16], [72, 90])],
  "ㄴ": [...P([26, 10], [26, 84], [90, 84])],
  "ㄷ": [...P([86, 16], [14, 16], [14, 84], [86, 84])],
  "ㄹ": [...P([14, 12], [86, 12], [86, 46], [14, 46], [14, 80], [86, 80])],
  "ㅁ": [...P([14, 14], [86, 14], [86, 86], [14, 86], [14, 14])],
  "ㅂ": [...P([16, 10], [16, 86], [86, 86], [86, 10]), ...P([16, 50], [86, 50])],
  "ㅅ": [...P([50, 12], [14, 88]), ...P([50, 12], [86, 88])],
  "ㅇ": ring(50, 50, 34),
  "ㅈ": [...P([12, 18], [88, 18]), ...P([50, 18], [14, 88]), ...P([50, 18], [86, 88])],
  "ㅊ": [...P([34, 4], [66, 4]), ...P([12, 30], [88, 30]), ...P([50, 30], [14, 92]), ...P([50, 30], [86, 92])],
  "ㅋ": [...P([12, 16], [88, 16], [72, 90]), ...P([40, 50], [84, 50])],
  "ㅌ": [...P([86, 14], [14, 14], [14, 86], [86, 86]), ...P([14, 50], [86, 50])],
  "ㅍ": [...P([10, 22], [90, 22]), ...P([10, 82], [90, 82]), ...P([32, 22], [32, 82]), ...P([68, 22], [68, 82])],
  "ㅎ": [...P([34, 4], [66, 4]), ...P([10, 28], [90, 28]), ...ring(50, 64, 24)],
  "ㅏ": [...P([50, 4], [50, 96]), ...P([50, 50], [88, 50])],
  "ㅑ": [...P([50, 4], [50, 96]), ...P([50, 32], [88, 32]), ...P([50, 68], [88, 68])],
  "ㅓ": [...P([50, 4], [50, 96]), ...P([12, 50], [50, 50])],
  "ㅕ": [...P([50, 4], [50, 96]), ...P([12, 32], [50, 32]), ...P([12, 68], [50, 68])],
  "ㅗ": [...P([4, 82], [96, 82]), ...P([50, 24], [50, 82])],
  "ㅛ": [...P([4, 82], [96, 82]), ...P([32, 24], [32, 82]), ...P([68, 24], [68, 82])],
  "ㅜ": [...P([4, 18], [96, 18]), ...P([50, 18], [50, 76])],
  "ㅠ": [...P([4, 18], [96, 18]), ...P([32, 18], [32, 76]), ...P([68, 18], [68, 76])],
  "ㅡ": [...P([4, 50], [96, 50])],
  "ㅣ": [...P([50, 4], [50, 96])],
};

const r1 = (n) => Math.round(n * 10) / 10;
const toPath = (points) => `M ${r1(points[0][0])} ${r1(points[0][1])} ` + points.slice(1).map(([x, y]) => `L ${r1(x)} ${r1(y)}`).join(" ") + " Z";

const glyphs = Object.entries(JAMO).map(([name, contours]) => ({
  name,
  kind: "base",
  unicode: `U+${name.codePointAt(0).toString(16).toUpperCase()}`,
  contours: contours.map(toPath),
  leftBearing: 0,
  rightBearing: 1,
  cellWidth: BOX,
  cellHeight: BOX,
}));

process.stdout.write(JSON.stringify({ version: 1, metrics: { ascender: 0.08, xHeight: 0.4, baseline: 0.88, descender: 0.98 }, glyphs }, null, 2));
