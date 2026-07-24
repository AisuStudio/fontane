// Generates fixtures/spike-lo.fff — a minimal synthetic Fontane project
// (glyphs "l" and "o", one stroke each, with Grid guide data) so the VF
// spike pipeline can run end-to-end without needing a hand-drawn export.
// Usage: node make-vf-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CELL_W = 200;
const CELL_H = 320;

// "l" — near-vertical stroke with a little wiggle, pressure ramping up.
const lPoints = [];
for (let i = 0; i < 14; i++) {
  const t = i / 13;
  lPoints.push([90 + Math.sin(t * Math.PI * 2) * 3, 60 + t * 190, 0.5 + t * 0.35]);
}

// "o" — closed-ish loop, pressure breathing around the circle.
const oPoints = [];
for (let i = 0; i <= 26; i++) {
  const a = (i / 26) * Math.PI * 2 - Math.PI / 2;
  oPoints.push([100 + Math.cos(a) * 48, 190 + Math.sin(a) * 48, 0.55 + 0.25 * Math.sin(a * 2)]);
}

const now = 1753300000000;
const fff = {
  version: 1,
  glyphs: [
    {
      id: "g-l", name: "l", kind: "base", unicode: "U+006C", strokeIds: ["s-l"], createdAt: now,
      leftBearing: 0.18, rightBearing: 0.62, cellWidth: CELL_W, cellHeight: CELL_H,
    },
    {
      id: "g-o", name: "o", kind: "base", unicode: "U+006F", strokeIds: ["s-o"], createdAt: now,
      leftBearing: 0.2, rightBearing: 0.8, cellWidth: CELL_W, cellHeight: CELL_H,
    },
  ],
  strokes: [
    { id: "s-l", points: lPoints, createdAt: now },
    { id: "s-o", points: oPoints, createdAt: now },
  ],
  vectorShapes: [],
  metrics: { ascender: 0.15, xHeight: 0.4, baseline: 0.75, descender: 0.95 },
  settings: { mode: "dynamic", size: 20, thinning: 0.7, smoothing: 0.5, streamline: 0.5 },
};

mkdirSync(join(here, "fixtures"), { recursive: true });
const out = join(here, "fixtures", "spike-lo.fff");
writeFileSync(out, JSON.stringify(fff, null, 2));
console.log("wrote", out);
