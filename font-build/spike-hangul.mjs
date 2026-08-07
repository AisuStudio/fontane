// Offline Hangul composition — turns a Fontane document with drawn jamo into
// one that also contains composed Korean syllables, ready for build_ttf.py.
//
// This is a thin CLI. All the geometry lives in src/lib/hangulCompose.ts,
// the same module the browser export uses, imported directly here (see
// ts-loader.mjs) so there is exactly one implementation of the layout rather
// than a browser copy and an offline copy that quietly diverge.
//
// Input is the compiled document (File → Export JSON in the app), NOT the
// .fff: the compiled document already carries each glyph's unioned contours
// as SVG path strings, which is what composition needs. Reading .fff instead
// would mean re-running compileDocument's stroke → outline → polygon-union
// pipeline out here for no gain.
//
// Usage:
//   node --import ./font-build/ts-register.mjs font-build/spike-hangul.mjs \
//     --in doc.json --out hangul-doc.json [options]
//
//     --all             every syllable (11.172) instead of the frequent ~2.350
//     --count N         a different subset size
//     --fit MODE        uniform (default) keeps each jamo's proportions inside
//                       its slot; stretch distorts it to fill the slot exactly
//     --components      emit syllables as references to the jamo glyphs rather
//                       than copies of their outlines. Roughly 25x smaller for
//                       the full set, and only build_ttf.py can consume it —
//                       the browser's CFF writer has no composites.
//
// Then:
//   python3 font-build/build_ttf.py hangul-doc.json out.ttf

import { readFileSync, writeFileSync } from "node:fs";
import { BASIC_JAMO, setMeasuredLayout } from "../src/lib/hangul.ts";
import { composeHangul, jamoFrom } from "../src/lib/hangulCompose.ts";

function parseArgs(argv) {
  const args = { in: null, out: null, count: null, fit: "uniform", all: false, components: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--fit") args.fit = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--components") args.components = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.in || !args.out) {
    throw new Error(
      "Usage: spike-hangul.mjs --in doc.json --out out.json [--all|--count N] [--fit uniform|stretch] [--components]"
    );
  }
  return args;
}

const args = parseArgs(process.argv);
const doc = JSON.parse(readFileSync(args.in, "utf8"));

// The layout the app was actually using.
//
// This is where the offline path used to disagree with the screen, silently.
// The measured table — read off the user's own drawn syllables — lives in the
// browser's localStorage, so composing again out here started from the shipped
// guess and moved every part of every syllable back to where the guess put it.
// The app now records the table it composed with in the document, and honouring
// it is the whole fix: same module, same numbers, same geometry.
//
// A document exported before this existed has no field and keeps the old
// behaviour, which is correct — it was built with the shipped table.
if (doc.hangulLayout) {
  setMeasuredLayout(doc.hangulLayout);
  console.log(`layout: from the document (${Object.keys(doc.hangulLayout).join(" ")})`);
} else {
  console.log("layout: shipped default — this document records none");
}

const source = jamoFrom(doc);
const missing = BASIC_JAMO.filter((j) => !source.has(j));
console.log(`jamo found: ${source.size}/24${missing.length ? ` — missing ${missing.join(" ")}` : ""}`);
if (source.size === 0) {
  console.error(
    "No jamo glyphs in that document. Draw them in the Grid first — glyph names must be the compatibility jamo, e.g. ㄱ."
  );
  process.exit(1);
}

// The frequent subset is what composeHangul picks by default; --count only
// needs to be spelled out when it differs.
const { frequentSyllables } = await import("../src/lib/hangul.ts");
const set = args.all ? "all" : args.count ? frequentSyllables(args.count) : "common";

const out = composeHangul(doc, {
  set,
  fit: args.fit,
  mode: args.components ? "components" : "outline",
});

const syllables = out.glyphs.filter((g) => g.script === "hangul").length - source.size;
writeFileSync(args.out, JSON.stringify(out));
const bytes = readFileSync(args.out).length;
console.log(
  `syllables: ${syllables} emitted (${args.components ? "components" : "outlines"}, fit=${args.fit})\n` +
    `glyphs total: ${out.glyphs.length}\n` +
    `document: ${(bytes / 1024 / 1024).toFixed(2)} MB  ->  ${args.out}`
);
