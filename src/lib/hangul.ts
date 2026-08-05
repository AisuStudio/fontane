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

// Side bearing, as a fraction of the em on each side. The first version had
// ink running from 0.03 to 0.97, which left syllables all but touching in
// running text — the em is the advance, so whatever the layout doesn't leave
// free IS the gap between syllables.
const SIDE = 0.07;
const INNER = 1 - 2 * SIDE;

export const DEFAULT_LAYOUT: LayoutTable = {
  // 가 — initial left, vowel right. Their TOPS align: a vertical vowel that
  // starts higher than the initial reads as falling over, and real Korean
  // faces line the two up. Only the vowel reaches further down.
  V: {
    initial: { x: SIDE, y: 0.08, w: INNER * 0.6, h: 0.78 },
    medialV: { x: SIDE + INNER * 0.66, y: 0.08, w: INNER * 0.34, h: 0.86 },
  },
  // 강 — same, squeezed up to make room for the batchim. The band is tighter
  // than it was: at 0.33 of the em it took so much that the syllable core
  // above it looked crushed.
  VT: {
    initial: { x: SIDE, y: 0.06, w: INNER * 0.58, h: 0.54 },
    medialV: { x: SIDE + INNER * 0.64, y: 0.06, w: INNER * 0.36, h: 0.58 },
    final: { x: SIDE + INNER * 0.06, y: 0.68, w: INNER * 0.88, h: 0.27 },
  },
  // 고 — initial on top, vowel underneath, full width
  H: {
    initial: { x: SIDE + INNER * 0.16, y: 0.07, w: INNER * 0.68, h: 0.46 },
    medialH: { x: SIDE, y: 0.58, w: INNER, h: 0.34 },
  },
  // 곰 — three stacked bands
  HT: {
    initial: { x: SIDE + INNER * 0.18, y: 0.04, w: INNER * 0.64, h: 0.34 },
    medialH: { x: SIDE, y: 0.42, w: INNER, h: 0.21 },
    final: { x: SIDE + INNER * 0.12, y: 0.68, w: INNER * 0.76, h: 0.27 },
  },
  // 과 — vowel wraps: wide part below the initial, upright part down the right
  M: {
    initial: { x: SIDE, y: 0.08, w: INNER * 0.46, h: 0.44 },
    medialH: { x: SIDE, y: 0.58, w: INNER * 0.7, h: 0.34 },
    medialV: { x: SIDE + INNER * 0.76, y: 0.08, w: INNER * 0.24, h: 0.86 },
  },
  // 관
  MT: {
    initial: { x: SIDE, y: 0.05, w: INNER * 0.42, h: 0.34 },
    medialH: { x: SIDE, y: 0.42, w: INNER * 0.66, h: 0.2 },
    medialV: { x: SIDE + INNER * 0.74, y: 0.05, w: INNER * 0.26, h: 0.57 },
    final: { x: SIDE + INNER * 0.1, y: 0.68, w: INNER * 0.8, h: 0.27 },
  },
};

// ---------------------------------------------------------------------------
// Context variants — the same consonant drawn for the place it actually sits
// ---------------------------------------------------------------------------
//
// Scaling one drawing into every slot makes the stroke weight follow the slot:
// a batchim squeezed to 56% of the initial's size comes out 56% as heavy. Real
// Korean faces don't shrink, they draw — the batchim is SMALLER, not LIGHTER,
// and it isn't even the same shape.
//
// So a consonant can be drawn up to three times, once per context. Anything
// not drawn falls back to the basic jamo, scaled as before: coverage never
// drops, quality rises per drawing.
export type JamoRole = "initV" | "initH" | "fin";

export type JamoVariant = {
  role: JamoRole;
  label: string;
  // A syllable that shows the position, e.g. 각 for the batchim. Faster than
  // any wording: "below the vowel" has to be read and pictured, 각 already is
  // the picture. Shown next to the label wherever the group is named.
  example: string;
  // The slot's own size, as fractions of the em. BOTH dimensions matter, not
  // just their ratio: a cell is drawn at cellSize x these fractions, so every
  // variant cell maps onto its slot by the SAME factor (em / cellSize). That
  // shared factor is what keeps the stroke weight even across the parts of a
  // syllable — give every cell the same width instead and a batchim, whose
  // slot is the widest, would come out ~46% heavier than an initial.
  w: number;
  h: number;
};

// Which layout classes each context covers. A consonant beside an upright
// vowel is tall and narrow; above a wide vowel it is short and wide; a batchim
// is a wide band under everything.
const VARIANT_CLASSES: Record<JamoRole, LayoutClass[]> = {
  initV: ["V", "VT"],
  initH: ["H", "HT", "M", "MT"],
  fin: ["VT", "HT", "MT"],
};

// Derived from the layout table rather than typed out, so a cell can't end up
// shaped unlike the slot it feeds. The representative class is the first one
// the context covers.
function slotSize(cls: LayoutClass, which: "initial" | "final"): { w: number; h: number } {
  const rect = which === "initial" ? DEFAULT_LAYOUT[cls].initial : DEFAULT_LAYOUT[cls].final!;
  return { w: rect.w, h: rect.h };
}

// Labels name the position, not the linguistics: "beside a vertical vowel" is
// accurate and unreadable — you have to know what a vertical vowel is before
// the sentence tells you anything. Where the consonant sits is the whole point,
// so that is what it says, with a syllable to point at.
export const JAMO_VARIANTS: JamoVariant[] = [
  { role: "initV", label: "Initial · left of the vowel", example: "가", ...slotSize("V", "initial") },
  { role: "initH", label: "Initial · above the vowel", example: "고", ...slotSize("H", "initial") },
  { role: "fin", label: "Final · under the syllable", example: "각", ...slotSize("VT", "final") },
];

// Variants are named, not encoded: "ㄱ.fin" is not a single codepoint, so
// unicodeFor() gives it no cmap entry and it can't be typed — exactly right
// for something that only ever appears inside a composed syllable. And it is
// kind "base", not "alternate", so the calt rotation in exportFont.ts leaves
// it alone.
export function variantName(jamo: string, role: JamoRole): string {
  return `${jamo}.${role}`;
}

export function allVariantSlots(): { name: string; base: string; role: JamoRole; w: number; h: number }[] {
  return JAMO_VARIANTS.flatMap((v) =>
    BASIC_CONSONANTS.map((jamo) => ({
      name: variantName(jamo, v.role),
      base: jamo,
      role: v.role,
      w: v.w,
      h: v.h,
    }))
  );
}

// Which context a given slot in a given class is, or null where no variant
// exists (vowels, for now).
function roleFor(cls: LayoutClass, slot: "initial" | "medial" | "final"): JamoRole | null {
  if (slot === "final") return VARIANT_CLASSES.fin.includes(cls) ? "fin" : null;
  if (slot === "initial") {
    if (VARIANT_CLASSES.initV.includes(cls)) return "initV";
    if (VARIANT_CLASSES.initH.includes(cls)) return "initH";
  }
  return null;
}

// Optical size correction, applied after a jamo has been fitted to its slot.
//
// A fit-inside rule scales by whichever axis runs out first, which is right
// for a bar and wrong for a circle: ㅇ inscribed in its slot reads visibly
// smaller than a ㅅ filling the same box, because the eye compares areas, not
// bounding boxes. Every typeface corrects this by hand — round and enclosed
// shapes are drawn slightly oversized so they *look* the same size.
//
// Values are deliberately mild and clamped at the call site so a boosted jamo
// can grow toward its slot's longer dimension but never burst out of it.
export const JAMO_OPTICAL_WEIGHT: Record<string, number> = {
  "ㅇ": 1.18, // circle — the worst offender
  "ㅎ": 1.12, // circle with a hat
  "ㅁ": 1.08, // square, same effect one step weaker
  "ㅂ": 1.06,
};

// Not every cluster splits 50:50. ㄹ is a tall, busy shape that needs room;
// ㄱ next to it is content with less. Weights are relative within one slot,
// so a pair of equal weights still divides evenly.
const CLUSTER_WIDTH: Record<string, number> = {
  "ㄹ": 1.25,
  "ㅁ": 1.1,
  "ㅂ": 1.1,
  "ㅣ": 0.7, // the trailing upright of ㅐ/ㅔ/ㅙ/ㅞ — a bare stroke needs little
};

// ---------------------------------------------------------------------------

// Whether a glyph/slot name belongs to Korean at all — covers standalone
// compatibility jamo (what the Grid's cells use), conjoining jamo (what other
// tools emit), and the precomposed syllables. Used to file a user-created
// glyph under the right script tab; only the first codepoint is examined,
// which is what a mixed name like a ligature would want anyway.
export function isHangulChar(name: string): boolean {
  const cp = name.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // conjoining jamo
    (cp >= 0x3131 && cp <= 0x318e) || // compatibility jamo
    (cp >= SYLLABLE_BASE && cp <= SYLLABLE_LAST) // precomposed syllables
  );
}

// How much of a cell's drawing area the em square takes. Not 1: a syllable
// needs air around it the way a Latin glyph gets air from its sidebearings,
// and a box flush against the canvas edge gives you nowhere to overshoot and
// no way to see where the em actually ends.
export const EM_BOX_FRACTION = 0.86;

// The em square inside a drawing area of the given size — the box a jamo is
// drawn in, and the box export maps onto the font's em.
//
// Lives here, next to the layout table, because three places need to agree on
// it exactly: the guides GridCell draws, exportFont.ts's emTransform, and
// font-build/build_ttf.py's em_transform (which mirrors this in Python).
// They were three separate copies of the same arithmetic before, which is
// precisely the kind of thing that drifts.
export function emBox(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height) * EM_BOX_FRACTION;
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

export type Decomposition ={ l: number; v: number; t: number; initial: string; medial: string; final: string };

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

// Splits by CLUSTER_WIDTH weight rather than evenly — see the table.
function splitRow(rect: Rect, parts: string[]): Rect[] {
  const n = parts.length;
  if (n <= 1) return [rect];
  const gap = rect.w * SUBSLOT_GAP;
  const usable = rect.w - gap * (n - 1);
  const weights = parts.map((j) => CLUSTER_WIDTH[j] ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Rect[] = [];
  let x = rect.x;
  for (let i = 0; i < n; i++) {
    const w = (usable * weights[i]) / total;
    out.push({ x, y: rect.y, w, h: rect.h });
    x += w + gap;
  }
  return out;
}

export type JamoPlacement = {
  // The glyph name to actually draw: a context variant when one has been
  // drawn, otherwise the basic jamo. Resolved here so the export and the
  // preview can't disagree about which drawing a syllable uses.
  jamo: string;
  base: string; // always one of BASIC_JAMO — never a compound
  role: "initial" | "medial" | "final";
  // Set only when `jamo` is a drawn variant. Consumers place a variant by its
  // CELL and a basic jamo by its INK — see the comment in hangulCompose.ts.
  variant?: JamoRole;
  rect: Rect; // where it goes in the unit em box, y down
  // Optical correction for this shape — see JAMO_OPTICAL_WEIGHT. Carried on
  // the placement so both consumers (export and preview) apply it without
  // each having to know the table.
  weight: number;
};

// The one function the rest of the app calls. Returns null for anything that
// isn't a Hangul syllable, so callers can use it as their own "is this
// composed?" test without a second range check.
export function placementFor(
  codepoint: number,
  layout: LayoutTable = DEFAULT_LAYOUT,
  // "does a glyph by this name exist and have ink" — supplied by whoever holds
  // the document. Omitted means "no variants", which is what every caller saw
  // before variants existed.
  hasGlyph?: (name: string) => boolean
): JamoPlacement[] | null {
  const parts = decompose(codepoint);
  if (!parts) return null;
  const shape = MEDIALS[parts.medial];
  const cls = layoutClassFor(parts.medial, parts.t !== 0);
  if (!shape || !cls) return null;
  const box = layout[cls];
  const out: JamoPlacement[] = [];

  const weightOf = (jamo: string) => JAMO_OPTICAL_WEIGHT[jamo] ?? 1;

  // Resolves one slot to the drawing it should use. With no `hasGlyph` the
  // answer is always the basic jamo, which is what every caller got before
  // variants existed — so this stays backwards compatible by construction.
  function place(base: string, slot: "initial" | "medial" | "final", rect: Rect): JamoPlacement {
    const role = roleFor(cls!, slot);
    const name = role ? variantName(base, role) : null;
    if (role && name && hasGlyph?.(name)) {
      // A drawn variant already has the size and weight it should have, so it
      // gets none of the compensation the scaled fallback needs.
      return { jamo: name, base, role: slot, variant: role, rect, weight: 1 };
    }
    return { jamo: base, base, role: slot, rect, weight: weightOf(base) };
  }

  const initials = consonantParts(parts.initial);
  splitRow(box.initial, initials).forEach((rect, i) => {
    out.push(place(initials[i], "initial", rect));
  });

  if (shape.horizontal && box.medialH) {
    out.push(place(shape.horizontal, "medial", box.medialH));
  }
  if (shape.vertical && box.medialV) {
    splitRow(box.medialV, shape.vertical).forEach((rect, i) => {
      out.push(place(shape.vertical![i], "medial", rect));
    });
  }

  if (parts.t !== 0 && box.final) {
    const finals = consonantParts(parts.final);
    splitRow(box.final, finals).forEach((rect, i) => {
      out.push(place(finals[i], "final", rect));
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
