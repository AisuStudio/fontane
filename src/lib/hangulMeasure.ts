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
// comes from the writing order (initial, then vowel, then batchim — three
// contiguous runs of strokes) with geometry only choosing between those few
// candidates. Then the bounding box of each run IS the slot.

import { decompose, emBox, layoutClassFor, type LayoutClass, type Rect } from "./hangul";

export type MeasuredSyllable = {
  char: string;
  cls: LayoutClass;
  // Every rect in em fractions, directly comparable with DEFAULT_LAYOUT.
  initial: Rect;
  medial: Rect;
  final: Rect | null;
  // How clean the split was: the gap that separated the parts, as a fraction
  // of the em. A syllable written with the batchim touching the vowel gives a
  // small number and deserves less trust than one with air between them.
  coreGap: number;
  sideGap: number;
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

// Read one drawn syllable's own geometry.
//
// Only classes with an upright vowel are handled (V and VT): those split into
// a left/right pair plus an optional band underneath, which two gaps describe
// completely. The wide-vowel classes stack differently and need their own
// pass — measuring them wrongly would be worse than not measuring them.
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
  if (cls !== "V" && cls !== "VT") return null;

  const box = emBox(cellWidth, cellHeight);

  // Korean is written in a fixed order — the whole initial, then the whole
  // vowel, then the batchim — so the strokes split into two or three
  // CONTIGUOUS runs. That is the reliable signal, and geometry only has to
  // choose between the handful of contiguous splits rather than find a
  // boundary on its own.
  //
  // Looking for the widest empty band instead (the obvious first idea) breaks
  // on exactly the letters this exists for: a three-bar ㅍ at the foot has
  // internal gaps larger than the gap separating it from the syllable above,
  // so the split lands inside the batchim.
  const wantParts = parts.t !== 0 ? 3 : 2;
  if (strokes.length < wantParts) return null;

  let best: { runs: MeasureStroke[][]; score: number } | null = null;
  const consider = (runs: MeasureStroke[][]) => {
    const rects = runs.map((r) => rectOf(r, box));
    if (rects.some((r) => r === null)) return;
    const [ini, med, fin] = rects as Rect[];
    // Three things make an upright-vowel syllable what it is, and a split
    // that produces all three is the right split:
    //   - air between the initial and the vowel, side by side
    //   - air above the batchim, sitting underneath both
    //   - a vowel that is TALL, which is what "upright" means
    //
    // The height term is not decoration. Without it the scoring happily
    // shaves the vowel's lowest stroke off into the batchim — that leaves a
    // hair more air above the batchim, so a gaps-only score prefers it, and
    // the vowel collapses to a single line.
    let score = med.x - (ini.x + ini.w) + med.h;
    if (fin) score += fin.y - Math.max(ini.y + ini.h, med.y + med.h);
    if (!best || score > best.score) best = { runs, score };
  };

  if (wantParts === 2) {
    for (let i = 1; i < strokes.length; i++) consider([strokes.slice(0, i), strokes.slice(i)]);
  } else {
    for (let i = 1; i < strokes.length - 1; i++)
      for (let j = i + 1; j < strokes.length; j++)
        consider([strokes.slice(0, i), strokes.slice(i, j), strokes.slice(j)]);
  }
  if (!best) return null;
  const chosen = (best as { runs: MeasureStroke[][]; score: number }).runs;

  const initialRect = rectOf(chosen[0], box);
  const medialRect = rectOf(chosen[1], box);
  if (!initialRect || !medialRect) return null;
  const finalRect = chosen[2] ? rectOf(chosen[2], box) : null;

  // How much air the drawing actually left between the parts, as a fraction
  // of the em. Small numbers mean the parts touch and the split is a judgement
  // call rather than a reading — worth showing rather than hiding.
  const gapBetween = (a: Rect | null, b: Rect | null, axis: "x" | "y") =>
    a && b ? (axis === "y" ? b.y - (a.y + a.h) : b.x - (a.x + a.w)) : 0;

  return {
    char,
    cls,
    initial: initialRect,
    medial: medialRect,
    final: finalRect,
    coreGap: finalRect
      ? gapBetween(
          {
            ...initialRect,
            h: Math.max(initialRect.y + initialRect.h, medialRect.y + medialRect.h) - initialRect.y,
          },
          finalRect,
          "y"
        )
      : 0,
    sideGap: gapBetween(initialRect, medialRect, "x"),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type SlotSummary = { x: number; y: number; w: number; h: number; n: number };

// Medians, not means: one syllable drawn with a wildly oversized batchim
// should not drag the table, and with fourteen samples a median is the more
// honest middle.
export function summarise(measured: MeasuredSyllable[]): {
  initial: SlotSummary | null;
  medial: SlotSummary | null;
  final: SlotSummary | null;
} {
  const pick = (rects: Rect[]): SlotSummary | null =>
    rects.length === 0
      ? null
      : {
          x: median(rects.map((r) => r.x)),
          y: median(rects.map((r) => r.y)),
          w: median(rects.map((r) => r.w)),
          h: median(rects.map((r) => r.h)),
          n: rects.length,
        };
  const withFinal = measured.filter((m) => m.cls === "VT" && m.final);
  return {
    initial: pick(withFinal.map((m) => m.initial)),
    medial: pick(withFinal.map((m) => m.medial)),
    final: pick(withFinal.map((m) => m.final as Rect)),
  };
}
