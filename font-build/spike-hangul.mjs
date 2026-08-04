// Hangul composition spike — turns a Fontane document with 24 drawn jamo into
// a document that also contains composed Korean syllables, ready for
// build_ttf.py.
//
// Input is the compiled document (File -> Export JSON in the app), NOT the
// .fff: the compiled document already carries each glyph's unioned contours
// as SVG path strings, which is exactly what composition needs. Reading .fff
// instead would mean re-implementing compileDocument's stroke -> outline ->
// polygon-union pipeline out here, for no gain.
//
// Everything this script emits lives in one shared 1000x1000 em box (y down,
// same orientation as canvas space). Paired with the METRICS below, that makes
// build_ttf.py's guide_transform an exact 1:1 mapping into font units:
//   scale    = ASCENT / ((baseline - ascender) * cellHeight) = 800 / 800 = 1
//   ty(y)    = baseline_px - y = 880 - y   -> box top 880, box bottom -120
//   advance  = (right - left) * cellWidth  = 1000, uniform for every syllable
// which is the standard place a CJK em square sits relative to the baseline.
//
// Usage:
//   node font-build/spike-hangul.mjs --in doc.json --out hangul-doc.json [options]
//     --count N     how many syllables to emit (default 2350; --all for 11172)
//     --fit MODE    uniform (default) keeps each jamo's proportions inside its
//                   slot; stretch distorts it to fill the slot exactly. The
//                   single biggest aesthetic lever — compare both.

import { readFileSync, writeFileSync } from "node:fs";
import {
  BASIC_JAMO,
  SYLLABLE_BASE,
  SYLLABLE_LAST,
  frequentSyllables,
  placementFor,
} from "../src/lib/hangul.ts";

const EM = 1000;

// ascender/baseline chosen so guide_transform comes out as identity — see the
// header. xHeight/descender are unused for Hangul but the shape is required.
const METRICS = { ascender: 0.08, xHeight: 0.4, baseline: 0.88, descender: 0.98 };

// How much of a slot a jamo is allowed to fill. Slightly under 1 so adjacent
// jamo don't touch — real Korean faces leave a little air between the initial
// and the vowel even when both are at full size.
const SLOT_FILL = 0.94;

// Where a standalone jamo glyph (its own cmap entry, e.g. typing ㄱ on its
// own) sits in the em box. Korean convention centres it rather than filling
// the square.
const STANDALONE_RECT = { x: 0.18, y: 0.15, w: 0.64, h: 0.7 };

const TOKEN_RE = /[MLQZ]|-?\d+(?:\.\d+)?/g;

function parsePath(d) {
  const tokens = d.match(TOKEN_RE) ?? [];
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M" || tok === "L") {
      out.push([tok, Number(tokens[i + 1]), Number(tokens[i + 2])]);
      i += 3;
    } else if (tok === "Q") {
      out.push([tok, Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3]), Number(tokens[i + 4])]);
      i += 5;
    } else {
      out.push(["Z"]);
      i += 1;
    }
  }
  return out;
}

// One decimal is well below a font unit's resolution at UPM 1000 and shaves
// roughly a third off the JSON compared to raw floats.
const r1 = (n) => Math.round(n * 10) / 10;

function serializePath(cmds) {
  return cmds
    .map((c) =>
      c[0] === "Z"
        ? "Z"
        : c[0] === "Q"
          ? `Q ${r1(c[1])} ${r1(c[2])} ${r1(c[3])} ${r1(c[4])}`
          : `${c[0]} ${r1(c[1])} ${r1(c[2])}`
    )
    .join(" ");
}

function boundsOf(contours) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const cmds of contours) {
    for (const c of cmds) {
      if (c[0] === "Z") continue;
      for (let i = 1; i < c.length; i += 2) {
        xmin = Math.min(xmin, c[i]); xmax = Math.max(xmax, c[i]);
        ymin = Math.min(ymin, c[i + 1]); ymax = Math.max(ymax, c[i + 1]);
      }
    }
  }
  return xmin === Infinity ? null : { xmin, xmax, ymin, ymax };
}

// Maps a jamo's own ink box into a target rect of the unit em box.
//
// "uniform" scales both axes by the same factor and centres the result, so a
// ㅇ stays a circle and a ㅡ stays a thin bar. "stretch" fills the slot
// exactly and distorts. Uniform is the default because the alternative turns
// every ㅇ into an ellipse whose eccentricity depends on the syllable it
// happens to sit in — the fastest way to make composed text look synthetic.
function fitTransform(bbox, rect, mode) {
  const srcW = Math.max(bbox.xmax - bbox.xmin, 1e-6);
  const srcH = Math.max(bbox.ymax - bbox.ymin, 1e-6);
  const dstW = rect.w * EM * SLOT_FILL;
  const dstH = rect.h * EM * SLOT_FILL;
  const sx = mode === "stretch" ? dstW / srcW : Math.min(dstW / srcW, dstH / srcH);
  const sy = mode === "stretch" ? dstH / srcH : sx;
  const originX = rect.x * EM + (rect.w * EM - srcW * sx) / 2;
  const originY = rect.y * EM + (rect.h * EM - srcH * sy) / 2;
  return {
    x: (x) => originX + (x - bbox.xmin) * sx,
    y: (y) => originY + (y - bbox.ymin) * sy,
  };
}

function applyTransform(contours, t) {
  return contours.map((cmds) =>
    cmds.map((c) => {
      if (c[0] === "Z") return c;
      if (c[0] === "Q") return ["Q", t.x(c[1]), t.y(c[2]), t.x(c[3]), t.y(c[4])];
      return [c[0], t.x(c[1]), t.y(c[2])];
    })
  );
}

function parseArgs(argv) {
  const args = { in: null, out: null, count: 2350, fit: "uniform", all: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--fit") args.fit = argv[++i];
    else if (a === "--all") args.all = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.in || !args.out) throw new Error("Usage: spike-hangul.mjs --in doc.json --out out.json [--count N|--all] [--fit uniform|stretch]");
  return args;
}

const args = parseArgs(process.argv);
const doc = JSON.parse(readFileSync(args.in, "utf8"));

// Collect the drawn jamo: any base glyph whose name is one of the 24. The
// glyph's own contours are kept in raw cell pixels here; every use of them
// below re-fits from the ink box, so the cell size they were drawn at never
// matters.
const jamoSource = new Map();
for (const g of doc.glyphs ?? []) {
  if (g.kind !== "base" || !BASIC_JAMO.includes(g.name)) continue;
  const contours = (g.contours ?? []).map(parsePath).filter((c) => c.length > 0);
  const bbox = boundsOf(contours);
  if (!bbox) continue;
  jamoSource.set(g.name, { contours, bbox });
}

const missing = BASIC_JAMO.filter((j) => !jamoSource.has(j));
console.log(`jamo found: ${jamoSource.size}/24${missing.length ? ` — missing ${missing.join(" ")}` : ""}`);
if (jamoSource.size === 0) {
  console.error("No jamo glyphs in that document. Draw them in the Grid first (glyph names must be the compatibility jamo, e.g. ㄱ).");
  process.exit(1);
}

const outGlyphs = [];

// Fontane names a glyph after the character itself ("a"), which the post
// table can't hold for anything outside Latin-1 — fontTools raises
// UnicodeEncodeError on the first ㄱ. So Hangul glyphs get AGL-style
// `uniXXXX` names instead; the cmap entry still comes from `unicode`, so
// nothing about how the font is USED changes. Phase 1 has to do the same in
// exportFont.ts's glyphNameFor().
const asciiName = (cp) => `uni${cp.toString(16).toUpperCase().padStart(4, "0")}`;

// Every glyph carries the same em-box calibration, which is what makes
// guide_transform behave as the identity described in the header.
function emit(name, unicode, contours) {
  outGlyphs.push({
    name,
    kind: "base",
    unicode,
    contours: contours.map(serializePath),
    leftBearing: 0,
    rightBearing: 1,
    cellWidth: EM,
    cellHeight: EM,
  });
}

// 1. The 24 jamo as standalone glyphs, so typing a bare ㄱ works too.
for (const [name, src] of jamoSource) {
  const cp = name.codePointAt(0);
  const t = fitTransform(src.bbox, STANDALONE_RECT, args.fit);
  emit(asciiName(cp), `U+${cp.toString(16).toUpperCase()}`, applyTransform(src.contours, t));
}

// 2. The syllables.
const targets = args.all
  ? Array.from({ length: SYLLABLE_LAST - SYLLABLE_BASE + 1 }, (_, i) => SYLLABLE_BASE + i)
  : frequentSyllables(args.count);

let skipped = 0;
for (const cp of targets) {
  const placements = placementFor(cp);
  if (!placements || placements.some((p) => !jamoSource.has(p.jamo))) {
    skipped++;
    continue;
  }
  const contours = [];
  for (const p of placements) {
    const src = jamoSource.get(p.jamo);
    contours.push(...applyTransform(src.contours, fitTransform(src.bbox, p.rect, args.fit)));
  }
  emit(asciiName(cp), `U+${cp.toString(16).toUpperCase()}`, contours);
}

const out = { version: 1, metrics: METRICS, glyphs: outGlyphs };
const json = JSON.stringify(out);
writeFileSync(args.out, json);

console.log(
  `syllables: ${targets.length - skipped} emitted, ${skipped} skipped (missing jamo)\n` +
    `glyphs total: ${outGlyphs.length}\n` +
    `document: ${(json.length / 1e6).toFixed(2)} MB  ->  ${args.out}`
);
