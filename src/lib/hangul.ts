// Hangul syllable composition — the geometry that turns 24 drawn jamo into
// any of the 11.172 precomposed Korean syllables.
//
// Deliberately dependency-free (no imports from anywhere in the app): the
// export path, the on-screen preview and the offline spike script in
// font-build/ all need exactly this table, and only one of them runs in a
// browser. Everything here is pure — codepoint in, rectangles out — so the
// same numbers can be unit-checked over all 11.172 syllables in a terminal.
//
// What this file does NOT do: touch strokes, contours, or fonts. It answers
// "which basic jamo go where, in a unit em box" and stops there. Callers own
// the actual transform of their own geometry into those rectangles.

// The Unicode Hangul Syllables block is a perfect 19 x 21 x 28 product, in
// that nesting order, with no gaps — which is why composition needs no lookup
// table at all, just division. (Jamo themselves are NOT laid out this
// conveniently; see the COMPAT_* tables below.)
export const SYLLABLE_BASE = 0xac00; // 가
export const L_COUNT = 19; // 초성 choseong — initial consonant
export const V_COUNT = 21; // 중성 jungseong — medial vowel
export const T_COUNT = 28; // 종성 jongseong — final consonant, index 0 = none
export const SYLLABLE_COUNT = L_COUNT * V_COUNT * T_COUNT; // 11.172
export const SYLLABLE_LAST = SYLLABLE_BASE + SYLLABLE_COUNT - 1; // U+D7A3, 힣

// Compatibility Jamo (U+3131..U+3163), not conjoining Jamo (U+1100..U+11FF).
// Three reasons: they're what a Korean keyboard emits for a standalone
// letter, they render in ordinary system fonts (so the Grid's reference
// letterform shows a real shape instead of tofu), and each is a single BMP
// codepoint — so a drawn jamo cell gets a real cmap entry from the existing
// unicodeFor() in glyphs.ts with no special-casing anywhere.
const COMPAT_L = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const COMPAT_V = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const COMPAT_T = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

// The 24 shapes a user actually draws. Every doubled consonant (ㄲ), every
// consonant cluster (ㄺ) and every compound vowel (ㅘ) is built from these by
// placing two of them side by side — see CONSONANT_PARTS / MEDIALS below.
// This is the whole promise of the feature: 24 cells, 11.172 syllables.
export const BASIC_CONSONANTS = ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
export const BASIC_VOWELS = ["ㅏ","ㅑ","ㅓ","ㅕ","ㅗ","ㅛ","ㅜ","ㅠ","ㅡ","ㅣ"];
export const BASIC_JAMO = [...BASIC_CONSONANTS, ...BASIC_VOWELS]; // 24

// Consonants that aren't basic, expressed as the basics they're written
// with. Doubles (ㄲ ㄸ ㅃ ㅆ ㅉ) are the same shape twice; clusters (ㄳ ㄵ ...)
// are two different shapes. Both are written side by side in the same slot,
// which is why one rule covers both.
const CONSONANT_PARTS: Record<string, string[]> = {
  "ㄲ": ["ㄱ","ㄱ"], "ㄸ": ["ㄷ","ㄷ"], "ㅃ": ["ㅂ","ㅂ"], "ㅆ": ["ㅅ","ㅅ"], "ㅉ": ["ㅈ","ㅈ"],
  "ㄳ": ["ㄱ","ㅅ"], "ㄵ": ["ㄴ","ㅈ"], "ㄶ": ["ㄴ","ㅎ"],
  "ㄺ": ["ㄹ","ㄱ"], "ㄻ": ["ㄹ","ㅁ"], "ㄼ": ["ㄹ","ㅂ"], "ㄽ": ["ㄹ","ㅅ"],
  "ㄾ": ["ㄹ","ㅌ"], "ㄿ": ["ㄹ","ㅍ"], "ㅀ": ["ㄹ","ㅎ"], "ㅄ": ["ㅂ","ㅅ"],
};

function consonantParts(jamo: string): string[] {
  return CONSONANT_PARTS[jamo] ?? [jamo];
}

// A medial vowel's written structure, which is also what decides the whole
// syllable's layout:
//   vertical   — a tall stroke to the RIGHT of the initial (ㅏ ㅓ ㅣ ...)
//   horizontal — a wide stroke BELOW the initial (ㅗ ㅜ ㅡ ...)
//   mixed      — both at once (ㅘ = ㅗ below + ㅏ right)
// `vertical` is a list because ㅐ/ㅔ/ㅙ/ㅞ append a second upright ㅣ to the
// right of the first — the only place a slot holds two *vowel* shapes.
type MedialShape = { kind: "vertical" | "horizontal" | "mixed"; horizontal?: string; vertical?: string[] };

const MEDIALS: Record<string, MedialShape> = {
  "ㅏ": { kind: "vertical", vertical: ["ㅏ"] },
  "ㅐ": { kind: "vertical", vertical: ["ㅏ","ㅣ"] },
  "ㅑ": { kind: "vertical", vertical: ["ㅑ"] },
  "ㅒ": { kind: "vertical", vertical: ["ㅑ","ㅣ"] },
  "ㅓ": { kind: "vertical", vertical: ["ㅓ"] },
  "ㅔ": { kind: "vertical", vertical: ["ㅓ","ㅣ"] },
  "ㅕ": { kind: "vertical", vertical: ["ㅕ"] },
  "ㅖ": { kind: "vertical", vertical: ["ㅕ","ㅣ"] },
  "ㅣ": { kind: "vertical", vertical: ["ㅣ"] },
  "ㅗ": { kind: "horizontal", horizontal: "ㅗ" },
  "ㅛ": { kind: "horizontal", horizontal: "ㅛ" },
  "ㅜ": { kind: "horizontal", horizontal: "ㅜ" },
  "ㅠ": { kind: "horizontal", horizontal: "ㅠ" },
  "ㅡ": { kind: "horizontal", horizontal: "ㅡ" },
  "ㅘ": { kind: "mixed", horizontal: "ㅗ", vertical: ["ㅏ"] },
  "ㅙ": { kind: "mixed", horizontal: "ㅗ", vertical: ["ㅏ","ㅣ"] },
  "ㅚ": { kind: "mixed", horizontal: "ㅗ", vertical: ["ㅣ"] },
  "ㅝ": { kind: "mixed", horizontal: "ㅜ", vertical: ["ㅓ"] },
  "ㅞ": { kind: "mixed", horizontal: "ㅜ", vertical: ["ㅓ","ㅣ"] },
  "ㅟ": { kind: "mixed", horizontal: "ㅜ", vertical: ["ㅣ"] },
  "ㅢ": { kind: "mixed", horizontal: "ㅡ", vertical: ["ㅣ"] },
};

// ---------------------------------------------------------------------------
// The layout table — six classes, and that is the entire Korean script.
// ---------------------------------------------------------------------------

// Unit em box, y DOWN (0 = top, 1 = bottom) to match canvas/cell space, which
// is what both consumers already work in: compileDocument's contours are raw
// cell pixels, and layoutText.ts stays y-down throughout. The font-space flip
// happens once, later, in the export transform — not here.
export type Rect = { x: number; y: number; w: number; h: number };

export type LayoutClass = "V" | "VT" | "H" | "HT" | "M" | "MT";

export type ClassLayout = {
  initial: Rect;
  medialV?: Rect; // the upright part, right column
  medialH?: Rect; // the wide part, bottom band
  final?: Rect; // batchim
};

// First-pass numbers, eyeballed from how Korean syllables are actually
// proportioned, NOT measured against a reference face. These ~70 values are
// the single thing worth tuning once real drawn jamo exist — Phase 2 exposes
// them as sliders. Everything else in this file is structural and shouldn't
// need to move.
export type LayoutTable = Record<LayoutClass, ClassLayout>;

export const DEFAULT_LAYOUT: LayoutTable = {
  // 가 — initial left, vowel right, both full height
  V: {
    initial: { x: 0.03, y: 0.09, w: 0.55, h: 0.82 },
    medialV: { x: 0.62, y: 0.04, w: 0.35, h: 0.92 },
  },
  // 강 — same, squeezed up to make room for the batchim
  VT: {
    initial: { x: 0.04, y: 0.05, w: 0.52, h: 0.55 },
    medialV: { x: 0.61, y: 0.02, w: 0.34, h: 0.60 },
    final: { x: 0.10, y: 0.64, w: 0.80, h: 0.33 },
  },
  // 고 — initial on top, vowel underneath, full width
  H: {
    initial: { x: 0.17, y: 0.06, w: 0.66, h: 0.48 },
    medialH: { x: 0.03, y: 0.58, w: 0.94, h: 0.36 },
  },
  // 곰 — three stacked bands
  HT: {
    initial: { x: 0.19, y: 0.03, w: 0.62, h: 0.36 },
    medialH: { x: 0.03, y: 0.42, w: 0.94, h: 0.22 },
    final: { x: 0.15, y: 0.67, w: 0.70, h: 0.30 },
  },
  // 과 — vowel wraps: wide part below the initial, upright part down the right
  M: {
    initial: { x: 0.04, y: 0.06, w: 0.44, h: 0.46 },
    medialH: { x: 0.03, y: 0.58, w: 0.68, h: 0.36 },
    medialV: { x: 0.74, y: 0.04, w: 0.23, h: 0.92 },
  },
  // 관
  MT: {
    initial: { x: 0.05, y: 0.03, w: 0.40, h: 0.36 },
    medialH: { x: 0.04, y: 0.42, w: 0.64, h: 0.21 },
    medialV: { x: 0.72, y: 0.02, w: 0.22, h: 0.61 },
    final: { x: 0.12, y: 0.67, w: 0.76, h: 0.30 },
  },
};

// ---------------------------------------------------------------------------

export type Decomposition = { l: number; v: number; t: number; initial: string; medial: string; final: string };

// The reason no lookup table is needed anywhere: the block is a dense product
// in L-major order, so integer division recovers the three indices exactly.
export function decompose(codepoint: number): Decomposition | null {
  if (codepoint < SYLLABLE_BASE || codepoint > SYLLABLE_LAST) return null;
  const i = codepoint - SYLLABLE_BASE;
  const l = Math.floor(i / (V_COUNT * T_COUNT));
  const v = Math.floor((i % (V_COUNT * T_COUNT)) / T_COUNT);
  const t = i % T_COUNT;
  return { l, v, t, initial: COMPAT_L[l], medial: COMPAT_V[v], final: COMPAT_T[t] };
}

export function compose(l: number, v: number, t: number): string {
  return String.fromCodePoint(SYLLABLE_BASE + (l * V_COUNT + v) * T_COUNT + t);
}

export function layoutClassFor(medial: string, hasFinal: boolean): LayoutClass | null {
  const shape = MEDIALS[medial];
  if (!shape) return null;
  const base = shape.kind === "vertical" ? "V" : shape.kind === "horizontal" ? "H" : "M";
  return (hasFinal ? `${base}T` : base) as LayoutClass;
}

// Splits one slot into n side-by-side sub-slots — the single rule that covers
// doubled consonants (ㄲ), consonant clusters (ㄺ) and the trailing ㅣ of
// ㅐ/ㅔ/ㅙ/ㅞ alike. The gap is a fraction of the slot's own width so it
// scales with the slot rather than with the em.
const SUBSLOT_GAP = 0.06;

function splitRow(rect: Rect, n: number): Rect[] {
  if (n <= 1) return [rect];
  const gap = rect.w * SUBSLOT_GAP;
  const w = (rect.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: rect.x + i * (w + gap), y: rect.y, w, h: rect.h }));
}

export type JamoPlacement = {
  jamo: string; // always one of BASIC_JAMO — never a compound
  role: "initial" | "medial" | "final";
  rect: Rect; // where it goes in the unit em box, y down
};

// The one function the rest of the app calls. Returns null for anything that
// isn't a Hangul syllable, so callers can use it as their own "is this
// composed?" test without a second range check.
export function placementFor(codepoint: number, layout: LayoutTable = DEFAULT_LAYOUT): JamoPlacement[] | null {
  const parts = decompose(codepoint);
  if (!parts) return null;
  const shape = MEDIALS[parts.medial];
  const cls = layoutClassFor(parts.medial, parts.t !== 0);
  if (!shape || !cls) return null;
  const box = layout[cls];
  const out: JamoPlacement[] = [];

  const initials = consonantParts(parts.initial);
  splitRow(box.initial, initials.length).forEach((rect, i) => {
    out.push({ jamo: initials[i], role: "initial", rect });
  });

  if (shape.horizontal && box.medialH) {
    out.push({ jamo: shape.horizontal, role: "medial", rect: box.medialH });
  }
  if (shape.vertical && box.medialV) {
    splitRow(box.medialV, shape.vertical.length).forEach((rect, i) => {
      out.push({ jamo: shape.vertical![i], role: "medial", rect });
    });
  }

  if (parts.t !== 0 && box.final) {
    const finals = consonantParts(parts.final);
    splitRow(box.final, finals.length).forEach((rect, i) => {
      out.push({ jamo: finals[i], role: "final", rect });
    });
  }

  return out;
}

// Powers the Grid's progress line ("18 of 24 jamo drawn -> 6.412 of 11.172
// syllables covered"). Brute-forces all 11.172 rather than deriving a closed
// form: it runs in a couple of milliseconds, and a closed form would have to
// be re-derived every time the parts tables change.
export function coverage(drawn: Iterable<string>): { covered: number; total: number; missing: string[] } {
  const have = new Set(drawn);
  let covered = 0;
  for (let cp = SYLLABLE_BASE; cp <= SYLLABLE_LAST; cp++) {
    const placements = placementFor(cp);
    if (placements && placements.every((p) => have.has(p.jamo))) covered++;
  }
  return { covered, total: SYLLABLE_COUNT, missing: BASIC_JAMO.filter((j) => !have.has(j)) };
}

// Which syllables to actually emit when the full 11.172 would blow the export
// budget. The obvious reference is KS X 1001's 2.350-syllable set — the subset
// every Korean foundry ships — but that list isn't derivable from the Unicode
// block, so claiming to *be* it would be a lie. Instead: rank each jamo by how
// common it is in written Korean, score a syllable by the sum of its parts'
// ranks, and take the best `count`. Exact target size, no false claim to a
// standard.
//
// Known limit, measured rather than assumed: syllable frequency is NOT
// derivable from jamo frequency. 괜찮아요 ("it's fine") is everyday Korean
// built from a rare vowel (ㅙ) and drops out at 2.350, while 갂 — a real but
// vanishingly rare syllable — survives because ㄱ and ㅏ are so common. No
// weighting of the three parts fixes that; only a real syllable-frequency
// list does. At 4.000 the everyday-word probes all pass. Treat the number as
// the product decision it is: below ~4.000, some ordinary words hit .notdef.
//
// Rank order is by rough written frequency, most common first. Doubled
// consonants and rare clusters sit at the end on purpose.
const RANK_L = ["ㅇ","ㄱ","ㄴ","ㅅ","ㅈ","ㄷ","ㅁ","ㅎ","ㄹ","ㅂ","ㅊ","ㅍ","ㅌ","ㅋ","ㄲ","ㅆ","ㅉ","ㄸ","ㅃ"];
const RANK_V = ["ㅏ","ㅣ","ㅡ","ㅓ","ㅗ","ㅜ","ㅐ","ㅔ","ㅕ","ㅑ","ㅛ","ㅠ","ㅘ","ㅚ","ㅢ","ㅝ","ㅟ","ㅖ","ㅒ","ㅙ","ㅞ"];
const RANK_T = ["","ㄴ","ㄹ","ㅇ","ㅁ","ㄱ","ㅅ","ㅂ","ㅈ","ㅎ","ㅆ","ㅊ","ㅌ","ㅍ","ㅋ","ㄲ","ㄺ","ㄻ","ㄼ","ㅄ","ㄳ","ㄵ","ㄶ","ㄽ","ㄾ","ㄿ","ㅀ","ㄷ"];

function rankOf(list: string[], jamo: string): number {
  const i = list.indexOf(jamo);
  return i === -1 ? list.length : i;
}

export const DEFAULT_SUBSET_SIZE = 2350; // the size Korean foundries settled on, if not the exact list

export function frequentSyllables(count: number = DEFAULT_SUBSET_SIZE): number[] {
  const scored: { cp: number; score: number }[] = [];
  for (let cp = SYLLABLE_BASE; cp <= SYLLABLE_LAST; cp++) {
    const d = decompose(cp)!;
    // Product, not sum. A sum lets one very common part carry a very rare one
    // (ㄱ + ㅏ dragged in 갂, whose ㄲ batchim is near-nonexistent), which is
    // exactly the wrong trade when every emitted syllable costs ~2 KB. A
    // product only keeps a syllable when *all three* parts are ordinary.
    const score =
      (rankOf(RANK_L, d.initial) + 1) * (rankOf(RANK_V, d.medial) + 1) * Math.pow(rankOf(RANK_T, d.final) + 1, 0.8);
    scored.push({ cp, score });
  }
  scored.sort((a, b) => a.score - b.score || a.cp - b.cp);
  return scored.slice(0, Math.min(count, scored.length)).map((s) => s.cp).sort((a, b) => a - b);
}
