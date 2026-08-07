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

// One stroke's own extent, in em fractions. Computed ONCE per stroke, which is
// the whole performance story of this file — see the loop below.
type Extent = { x0: number; y0: number; x1: number; y1: number };

function extentOf(stroke: MeasureStroke, box: { x: number; y: number; size: number }): Extent | null {
  const b = bboxOf([stroke]);
  if (!b) return null;
  return {
    x0: (b.xmin - box.x) / box.size,
    y0: (b.ymin - box.y) / box.size,
    x1: (b.xmax - box.x) / box.size,
    y1: (b.ymax - box.y) / box.size,
  };
}

// The box around strokes [from, to). Also serves as "everything written so
// far" when called with from = 0: a part is separated from ALL its
// predecessors, not just the last one — the batchim of 강 sits below the
// initial and the vowel together, and the upright half of ㅘ sits to the right
// of both the initial and the wide half.
function spanRect(ext: Extent[], from: number, to: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = from; i < to; i++) {
    if (ext[i].x0 < x0) x0 = ext[i].x0;
    if (ext[i].y0 < y0) y0 = ext[i].y0;
    if (ext[i].x1 > x1) x1 = ext[i].x1;
    if (ext[i].y1 > y1) y1 = ext[i].y1;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Above this many strokes the enumeration stops being worth its cost, and a
// syllable drawn with that many is not going to be read reliably anyway. No
// measurement is a state the panel already handles; a frozen tab is not.
const MAX_STROKES = 40;

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
  if (strokes.length < keys.length || strokes.length > MAX_STROKES) return null;

  // Each stroke's extent, once. The first version of this loop re-derived
  // every run's box from its POINTS for every candidate split, so the work was
  // (number of splits) x (every point in the syllable) — and going from three
  // parts to four multiplied the number of splits by the stroke count. On a
  // syllable of twenty strokes that is roughly a thousand splits over a couple
  // of thousand points, recomputed on every stroke drawn, for every syllable
  // in the document. It made the grid crawl.
  //
  // With the extents precomputed a split costs O(strokes) instead of
  // O(points), which is two orders of magnitude on real drawings.
  const ext: Extent[] = [];
  for (const s of strokes) {
    const e = extentOf(s, box);
    if (!e) return null;
    ext.push(e);
  }

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

  const n = strokes.length;
  const cuts = new Array<number>(keys.length - 1);

  const evaluate = () => {
    const rects: Rect[] = [];
    let from = 0;
    for (let i = 0; i < keys.length; i++) {
      const to = i === keys.length - 1 ? n : cuts[i];
      rects.push(spanRect(ext, from, to));
      from = to;
    }

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
    for (let i = 1; i < keys.length; i++) {
      const before = spanRect(ext, 0, cuts[i - 1]);
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
  };

  // Every way of cutting the strokes into as many contiguous runs as the class
  // has parts, each run holding at least one. Contiguity is the whole
  // constraint — anything else and this would be searching for a partition
  // rather than choosing a boundary. Walked as indices into one reused array
  // rather than materialised as lists of lists, which for four parts was
  // allocating thousands of sliced arrays per syllable.
  const walk = (depth: number, start: number) => {
    if (depth === cuts.length) return evaluate();
    const last = n - (cuts.length - depth);
    for (let i = start; i <= last; i++) {
      cuts[depth] = i;
      walk(depth + 1, i + 1);
    }
  };
  walk(0, 1);
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
