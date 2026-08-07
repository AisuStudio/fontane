// Measuring the layout table instead of guessing it.
//
// DEFAULT_LAYOUT's ~70 numbers were eyeballed from how Korean syllables are
// proportioned in print. They have never been compared against a person's
// handwriting, and it shows: strokes fall outside every slot, the harvest's
// nearest-slot fallback puts them somewhere, and a whole initial ends up
// inside the batchim cell.
//
// A drawn syllable already contains the answer: ink written as 각 falls into
// three clumps, which is what makes it legible as three parts. So the slots
// can be READ off the drawing rather than asserted.
//
// Deliberately structural, not statistical: nothing here averages over the
// table we are trying to replace, and nothing is fitted to it. The split
// comes from the writing order (initial, then vowel, then batchim — as many
// contiguous runs of strokes as the syllable has parts) with geometry only
// choosing between those few candidates. Then the bounding box of each run IS
// the slot.

import { decompose, emBox, layoutClassFor, type ClassLayout, type LayoutClass, type Rect } from "./hangul";

// The slot keys, in the order a hand writes them. This is the whole reason the
// split is tractable: Korean has a fixed writing order, so the strokes of a
// syllable are already grouped — they only have to be cut, not sorted.
//
//   V   가   initial, then the upright vowel beside it
//   VT  강   ...then the batchim underneath both
//   H   고   initial, then the wide vowel below it
//   HT  곰   ...then the batchim below that
//   M   과   initial, then the vowel's wide part under it, then its upright
//            part down the right side (ㅘ is written ㅗ first, ㅏ second)
//   MT  관   ...then the batchim under all of it
export type MeasuredKey = "initial" | "medialV" | "medialH" | "final";

const WRITING_ORDER: Record<LayoutClass, MeasuredKey[]> = {
  V: ["initial", "medialV"],
  VT: ["initial", "medialV", "final"],
  H: ["initial", "medialH"],
  HT: ["initial", "medialH", "final"],
  M: ["initial", "medialH", "medialV"],
  MT: ["initial", "medialH", "medialV", "final"],
};

// Which direction separates each part from everything written before it. This
// is the only place the six classes differ, and it is what the score reads.
//
//   x — the part sits BESIDE what came before (an upright vowel, and in the
//       wrapping classes the upright half of ㅘ)
//   y — the part sits BELOW it (a wide vowel, and every batchim)
const SEPARATED_BY: Record<LayoutClass, ("x" | "y")[]> = {
  V: ["x"],
  VT: ["x", "y"],
  H: ["y"],
  HT: ["y", "y"],
  M: ["y", "x"],
  MT: ["y", "x", "y"],
};

export type MeasuredSyllable = {
  char: string;
  cls: LayoutClass;
  // Every rect in em fractions, directly comparable with DEFAULT_LAYOUT. Which
  // keys are present is decided by the class, exactly as in the table itself.
  slots: Partial<Record<MeasuredKey, Rect>>;
  // How clean the split was: the SMALLEST gap that separated two parts, as a
  // fraction of the em. A syllable written with the batchim touching the vowel
  // gives a small number and deserves less trust than one with air between
  // them. The smallest, not the average, because one tight boundary is enough
  // to make the reading a judgement call.
  gap: number;
};

type Pt = [number, number, number] | number[];
export type MeasureStroke = { id: string; points: Pt[] };

function bboxOf(strokes: MeasureStroke[]) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      if (p[0] < xmin) xmin = p[0];
      if (p[0] > xmax) xmax = p[0];
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
    }
  return xmin === Infinity ? null : { xmin, ymin, xmax, ymax };
}

function rectOf(strokes: MeasureStroke[], box: { x: number; y: number; size: number }): Rect | null {
  const b = bboxOf(strokes);
  if (!b) return null;
  return {
    x: (b.xmin - box.x) / box.size,
    y: (b.ymin - box.y) / box.size,
    w: (b.xmax - b.xmin) / box.size,
    h: (b.ymax - b.ymin) / box.size,
  };
}

// The box enclosing everything written so far. A part is separated from ALL of
// its predecessors, not just the last one: the batchim of 강 sits below the
// initial and the vowel together, and the upright half of ㅘ sits to the right
// of both the initial and the wide half.
function unionOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}

// Every way of cutting `count` contiguous runs out of a list, each run holding
// at least one stroke. Contiguity is the whole constraint — anything else and
// this would be searching for a partition rather than choosing a boundary.
function contiguousSplits<T>(items: T[], count: number): T[][][] {
  if (count === 1) return [[items]];
  const out: T[][][] = [];
  for (let i = 1; i <= items.length - (count - 1); i++)
    for (const rest of contiguousSplits(items.slice(i), count - 1)) out.push([items.slice(0, i), ...rest]);
  return out;
}

// Read one drawn syllable's own geometry.
//
// All six classes, which the first version deliberately did not do: it handled
// the upright-vowel pair (V, VT) and refused the rest, because measuring a
// stacked syllable with a side-by-side rule would have been worse than not
// measuring it. What makes the rest tractable is WRITING_ORDER — the classes
// differ only in how many parts there are and which direction separates them,
// so one scorer covers all six as long as it is told the direction.
export function measureSyllable(
  char: string,
  strokes: MeasureStroke[],
  cellWidth: number,
  cellHeight: number
): MeasuredSyllable | null {
  const cp = char.codePointAt(0);
  if (cp === undefined || strokes.length < 2) return null;
  const parts = decompose(cp);
  if (!parts) return null;
  const cls = layoutClassFor(parts.medial, parts.t !== 0);
  if (!cls) return null;

  const box = emBox(cellWidth, cellHeight);
  const keys = WRITING_ORDER[cls];
  const axes = SEPARATED_BY[cls];
  if (strokes.length < keys.length) return null;

  // Looking for the widest empty band instead (the obvious first idea) breaks
  // on exactly the letters this exists for: a three-bar ㅍ at the foot has
  // internal gaps larger than the gap separating it from the syllable above,
  // so the split lands inside the batchim. Enumerating contiguous cuts and
  // scoring each one asks a question handwriting can answer.
  //
  // What it still cannot answer, found while extending this to the stacked
  // classes: a part whose own strokes are further apart than the space between
  // the parts. Two lonely horizontal lines 0.4 of an em apart, with the vowel
  // only 0.11 below them, get cut between the lines — and that is the right
  // answer to the question being asked, because such a drawing genuinely has
  // no clump. The remedy is the one already built: the harvest map shows the
  // reading, and a stroke in the wrong slot can be clicked into the right one.
  let best: { rects: Rect[]; score: number; gap: number } | null = null;

  for (const runs of contiguousSplits(strokes, keys.length)) {
    const maybe = runs.map((r) => rectOf(r, box));
    if (maybe.some((r) => r === null)) continue;
    const rects = maybe as Rect[];

    // Two things make a split the right split, and both are needed:
    //
    //   - AIR. Each part is separated from everything before it, along the
    //     direction its class says. Sum the gaps and the best cut is the one
    //     that falls in the whitespace a hand left.
    //   - SHAPE. An upright vowel is TALL and a wide one is WIDE, so reward
    //     the dimension that makes it what it is.
    //
    // The shape term is not decoration. Without it the scoring happily shaves
    // the vowel's lowest stroke off into the batchim — that leaves a hair more
    // air above the batchim, so a gaps-only score prefers it, and the vowel
    // collapses to a single line.
    let score = 0;
    let smallest = Infinity;
    for (let i = 1; i < rects.length; i++) {
      const before = unionOf(rects.slice(0, i));
      const gap =
        axes[i - 1] === "x" ? rects[i].x - (before.x + before.w) : rects[i].y - (before.y + before.h);
      score += gap;
      if (gap < smallest) smallest = gap;
    }
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === "medialV") score += rects[i].h;
      if (keys[i] === "medialH") score += rects[i].w;
    }
    if (!best || score > best.score) best = { rects, score, gap: smallest };
  }
  if (!best) return null;

  const chosen = best as { rects: Rect[]; score: number; gap: number };
  const slots: Partial<Record<MeasuredKey, Rect>> = {};
  keys.forEach((key, i) => {
    slots[key] = chosen.rects[i];
  });
  return { char, cls, slots, gap: chosen.gap };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One class's worth of reading: the table entry it would become, plus how many
// drawings it came from. The count travels with the numbers rather than beside
// them — a class read from a single syllable and one read from fourteen are
// not the same claim, and the difference has to survive as far as the panel.
export type MeasuredClass = ClassLayout & { n: number; gap: number };

// Medians, not means: one syllable drawn with a wildly oversized batchim
// should not drag the table, and a median is the more honest middle.
export function summarise(measured: MeasuredSyllable[]): Partial<Record<LayoutClass, MeasuredClass>> {
  const out: Partial<Record<LayoutClass, MeasuredClass>> = {};
  const classes = new Set(measured.map((m) => m.cls));
  for (const cls of classes) {
    const mine = measured.filter((m) => m.cls === cls);
    const pick = (key: MeasuredKey): Rect | undefined => {
      const rects = mine.map((m) => m.slots[key]).filter((r): r is Rect => Boolean(r));
      if (rects.length === 0) return undefined;
      return {
        x: median(rects.map((r) => r.x)),
        y: median(rects.map((r) => r.y)),
        w: median(rects.map((r) => r.w)),
        h: median(rects.map((r) => r.h)),
      };
    };
    const initial = pick("initial");
    if (!initial) continue; // every class has one; without it there is no entry to write
    out[cls] = {
      initial,
      ...(pick("medialV") ? { medialV: pick("medialV") } : {}),
      ...(pick("medialH") ? { medialH: pick("medialH") } : {}),
      ...(pick("final") ? { final: pick("final") } : {}),
      n: mine.length,
      gap: median(mine.map((m) => m.gap)),
    };
  }
  return out;
}

// The table to put in force, with the sample counts stripped back off. A class
// nobody drew is simply absent, and setMeasuredLayout keeps the shipped guess
// for it rather than inventing one.
export function asLayout(summary: Partial<Record<LayoutClass, MeasuredClass>>) {
  const out: Partial<Record<LayoutClass, ClassLayout>> = {};
  for (const [cls, m] of Object.entries(summary) as [LayoutClass, MeasuredClass][]) {
    out[cls] = {
      initial: m.initial,
      ...(m.medialV ? { medialV: m.medialV } : {}),
      ...(m.medialH ? { medialH: m.medialH } : {}),
      ...(m.final ? { final: m.final } : {}),
    };
  }
  return out;
}
