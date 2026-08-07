// Lifting drawn parts out of a drawn syllable.
//
// The composition path in hangulCompose.ts goes one way — parts in, syllable
// out. This goes the other way: a syllable someone wrote by hand comes in, and
// the pieces come out as variant glyphs that composition can then use for
// every other syllable they appear in.
//
// Why bother, when a variant cell can be drawn directly: a fixed pen inside a
// small box lays down a relatively fat stroke, and the batchim's box is 0.27
// of the em. Drawn as part of a whole syllable the reference frame is the
// syllable, so the hand picks the batchim's size and density itself — which is
// the compromise real Korean faces make too, and not one a scale factor can
// arrive at.
//
// Strokes are assigned, never cut. A stroke belongs to whichever slot most of
// it lies in; anything that pokes out of that slot pokes out of the harvested
// cell too, exactly as overshoot does everywhere else in the app.

import {
  activeLayout,
  jamoVariants,
  decompose,
  emBox,
  layoutClassFor,
  variantName,
  type JamoRole,
  type LayoutClass,
  type Rect,
} from "./hangul";

export type HarvestPoint = [number, number, number] | number[];
export type HarvestStroke = { id: string; points: HarvestPoint[]; widthScale?: number };

export type SlotKey = "initial" | "medialV" | "medialH" | "final";

export type HarvestSlot = {
  key: SlotKey;
  // The context this slot's ink could be harvested into, or null where no
  // variant exists for it (every vowel, and an initial in a class whose slot
  // shape doesn't match the declared variant cell — see harvestSyllables()).
  role: JamoRole | null;
  base: string; // the jamo written in this slot
  // In cell pixels, not em fractions: the caller works in the cell's own
  // coordinates, which is where strokes live.
  rect: Rect;
};

// The slots of one syllable, positioned inside a drawing cell of the given
// size. Mirrors placementFor()'s geometry but stops at whole slots — cluster
// splitting (ㄺ, ㅐ) is deliberately not applied, because a hand-drawn cluster
// is written as one gesture and splitting it would cut strokes in half.
export function harvestSlots(char: string, cellWidth: number, cellHeight: number): HarvestSlot[] {
  const cp = char.codePointAt(0);
  if (cp === undefined) return [];
  const parts = decompose(cp);
  if (!parts) return [];
  const cls = layoutClassFor(parts.medial, parts.t !== 0);
  if (!cls) return [];
  const box = emBox(cellWidth, cellHeight);
  const toCell = (r: Rect): Rect => ({
    x: box.x + r.x * box.size,
    y: box.y + r.y * box.size,
    w: r.w * box.size,
    h: r.h * box.size,
  });

  const layout = activeLayout()[cls];
  const out: HarvestSlot[] = [];
  if (layout.initial) out.push({ key: "initial", role: initialRole(cls), base: parts.initial, rect: toCell(layout.initial) });
  if (layout.medialV) out.push({ key: "medialV", role: null, base: parts.medial, rect: toCell(layout.medialV) });
  if (layout.medialH) out.push({ key: "medialH", role: null, base: parts.medial, rect: toCell(layout.medialH) });
  if (layout.final && parts.t !== 0) out.push({ key: "final", role: "fin", base: parts.final, rect: toCell(layout.final) });
  return out;
}

// An initial is only harvestable where the class it sits in has the same
// proportions as the variant cell it would land in. initV's cell is shaped
// from class V (0.52 x 0.78); the same context in class VT is 0.50 x 0.54, and
// a cell squeezed into a slot a third shorter than itself loses exactly the
// weight this whole exercise is about. So a syllable with a batchim teaches
// its batchim and nothing else, until initV is split in two.
function initialRole(cls: LayoutClass): JamoRole | null {
  const role = cls === "V" ? "initV" : cls === "H" ? "initH" : null;
  // ...and only if that context still exists as a variant. It does not today —
  // jamoVariants() is the batchim alone — and naming a role nothing declares
  // would have the harvest write a glyph into a cell the grid never shows.
  // The practice sheet gained flat-vowel syllables (class H) for the vowels'
  // sake, which is exactly what would have started producing those phantoms.
  return role && jamoVariants().some((v) => v.role === role) ? role : null;
}

function bounds(points: HarvestPoint[]) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const p of points) {
    if (p[0] < xmin) xmin = p[0];
    if (p[0] > xmax) xmax = p[0];
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  return { xmin, ymin, xmax, ymax };
}

// Squared distance from a point to a rectangle; 0 anywhere inside it.
//
// The slots do not tile the em box — they are the tight boxes each part is
// PLACED in, so there are gaps between them, and a hand writes straight
// through those gaps. Measured on real drawings: the initial's box ends at
// 0.60 of the em and the batchim's starts at 0.68, and strokes sit squarely
// in between. Asking "is this point inside a slot" answers no for all of
// them; asking "which slot is it nearest" always answers something sensible.
function distanceToRect(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return dx * dx + dy * dy;
}

// Which slot each stroke belongs to.
//
// Counting the stroke's own points inside each rect, rather than testing its
// bounding box: a batchim ㄴ and the vowel's upright stem have overlapping
// bounding boxes but almost no shared points, and handwriting routinely
// overshoots a slot's edge without the stroke belonging anywhere else. A
// stroke that lands in nothing (drawn well outside every slot) goes to the
// nearest slot centre rather than being dropped — losing a stroke silently is
// worse than putting it somewhere the user can correct.
export type StrokeAssignment = {
  id: string;
  slot: SlotKey;
  // Fraction of the stroke's points that actually fell inside that slot. 0
  // means nothing did and the nearest-centre fallback picked it — the case
  // worth showing a user, because that is where a wrong slot comes from and
  // where the layout table is being asked a question it was never measured
  // to answer.
  score: number;
};

export function assignStrokesDetailed(slots: HarvestSlot[], strokes: HarvestStroke[]): StrokeAssignment[] {
  const out: StrokeAssignment[] = [];
  if (slots.length === 0) return out;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    // Every point votes for the slot it is NEAREST to, which for a point
    // inside one is that one. Counting only containment made a stroke written
    // through the gap between two slots belong to neither, and the whole
    // stroke then fell to a single nearest-CENTRE guess for its bounding box —
    // which is how an initial ended up in the batchim cell.
    const votes = new Map<SlotKey, number>();
    let contained = 0;
    for (const p of stroke.points) {
      let best: SlotKey = slots[0].key;
      let bestD = Infinity;
      for (const slot of slots) {
        const d = distanceToRect(slot.rect, p[0], p[1]);
        if (d < bestD) {
          bestD = d;
          best = slot.key;
        }
      }
      if (bestD === 0) contained++;
      votes.set(best, (votes.get(best) ?? 0) + 1);
    }
    let winner = slots[0].key;
    let most = -1;
    for (const [key, n] of votes) {
      if (n > most) {
        most = n;
        winner = key;
      }
    }
    // The score still means "how much of this stroke actually landed in a
    // slot", so the panel keeps warning about ink the layout doesn't cover —
    // it just no longer decides where the stroke goes.
    out.push({ id: stroke.id, slot: winner, score: contained / stroke.points.length });
  }
  return out;
}

export function assignStrokes(slots: HarvestSlot[], strokes: HarvestStroke[]): Record<string, SlotKey> {
  const out: Record<string, SlotKey> = {};
  for (const a of assignStrokesDetailed(slots, strokes)) out[a.id] = a.slot;
  return out;
}

export type HarvestResult = {
  name: string; // e.g. "ㄱ.fin"
  role: JamoRole;
  base: string;
  cellWidth: number;
  cellHeight: number;
  strokes: HarvestStroke[];
  // How far this part sticks out, and how far it is allowed to. See overflowOf.
  overflow: Overflow;
  overflowLimit: number;
};

// ---------------------------------------------------------------------------
// The emergency brake
// ---------------------------------------------------------------------------
//
// Every step before this one is a guess about handwriting: which slot a stroke
// belongs to, where the slots are, whether the layout table matches the hand
// that drew the syllable. When those guesses go wrong they don't go wrong
// quietly — a whole initial assigned to the batchim slot gets positioned
// relative to a rectangle it sits a third of an em ABOVE, and arrives in the
// variant cell as a smear reaching several cell-heights past the top edge.
//
// That case is not ambiguous and it should never be written. Overshoot IS
// normal — a generous batchim pokes a few percent past its cell the same way
// ink overshoots everywhere else in the app — so the threshold is set far
// above anything a hand produces and far below the failure: half a cell
// clear of an edge is not a drawn letter, it is ink that came from somewhere
// else.
//
// Reported, never silently dropped. A part held back is a part the user has to
// be told about, because the fix is theirs: move the stroke to the right slot,
// or adopt the measured layout so the slots sit where they drew them.
export type Overflow = { left: number; right: number; top: number; bottom: number; worst: number };

// Two limits, because the two checks measure against rectangles we know
// differently well.
//
// CELL is a box this code constructed from the variant's own slot fractions.
// Ink outside it came from outside, and half a cell is already far beyond any
// overshoot a hand produces.
//
// SLOT is a box out of the layout table — which is a GUESS, and demonstrably a
// poor one for some hands, since strokes falling outside it is the whole
// reason the measurement exists. Judging a drawing against a rectangle we
// admit is wrong has to be generous or it will hold back honest work: a vowel
// slot is barely a third of an em wide, so an arm reaching a little further
// left is normal. A full slot clear of the edge is not.
export const OVERFLOW_LIMIT = 0.5;
export const SLOT_OVERFLOW_LIMIT = 1;

export function overflowOf(result: {
  cellWidth: number;
  cellHeight: number;
  strokes: HarvestStroke[];
}): Overflow {
  const pts = result.strokes.flatMap((s) => s.points);
  if (pts.length === 0) return { left: 0, right: 0, top: 0, bottom: 0, worst: 0 };
  const b = bounds(pts);
  // Each side as a fraction of the dimension it crosses, so the number means
  // the same thing whatever shape the cell is — a batchim cell is three times
  // as wide as it is tall, and "0.5 out" has to be half a cell either way.
  const left = Math.max(0, -b.xmin) / result.cellWidth;
  const right = Math.max(0, b.xmax - result.cellWidth) / result.cellWidth;
  const top = Math.max(0, -b.ymin) / result.cellHeight;
  const bottom = Math.max(0, b.ymax - result.cellHeight) / result.cellHeight;
  return { left, right, top, bottom, worst: Math.max(left, right, top, bottom) };
}

export function isSpill(result: HarvestResult): boolean {
  return result.overflow.worst > result.overflowLimit;
}

// Which edge it went through, for a message that says something. "0.62 out"
// is a number; "reaches 62% of a cell past the top" is a diagnosis, and the
// top edge in particular is the signature of an initial that landed in the
// batchim slot.
export function spillEdge(o: Overflow): "left" | "right" | "top" | "bottom" {
  if (o.worst === o.top) return "top";
  if (o.worst === o.bottom) return "bottom";
  if (o.worst === o.left) return "left";
  return "right";
}

// The cell a harvested variant lands in, in pixels. Both dimensions come from
// the variant's own slot fractions against one shared cellSize, which is what
// makes every variant cell map onto its slot by the SAME factor — and that
// shared factor IS the even stroke weight. Do not "fix" this by giving the
// cells a common width.
export function variantCellSize(role: JamoRole, cellSize: number): { width: number; height: number } {
  const v = jamoVariants().find((x) => x.role === role);
  if (!v) return { width: cellSize, height: cellSize };
  return { width: cellSize * v.w, height: cellSize * v.h };
}

// Move the strokes of one slot into their variant cell.
//
// The geometry is scaled by k (the cell is 1/EM_BOX_FRACTION larger than the
// slot it was read from) and the thickness has to follow, or the harvested
// glyph would keep the syllable's absolute stroke width inside a cell that
// then gets scaled down again at composition time — arriving thinner than it
// started. widthScale is the same field the Scale tool bakes, for the same
// reason.
//
// `weight` is the one deliberate departure, and the only knob that changes
// how a harvested part looks: it multiplies thickness and nothing else, so no
// point ever moves. 1 is exactly as drawn. Below it for a dense batchim, which
// clots at full weight — real Korean faces take 5-15% out of one; above it for
// a sparse one that would otherwise disappear into its band. A design
// decision, which is why it has no opinionated default.
export function harvestSlot(
  slot: HarvestSlot,
  strokes: HarvestStroke[],
  assignment: Record<string, SlotKey>,
  cellSize: number,
  weight = 1
): HarvestResult | null {
  if (!slot.role) return null;
  const mine = strokes.filter((s) => assignment[s.id] === slot.key);
  if (mine.length === 0) return null;

  const cell = variantCellSize(slot.role, cellSize);
  const k = cell.width / slot.rect.w;

  const out = {
    name: variantName(slot.base, slot.role),
    role: slot.role,
    base: slot.base,
    cellWidth: cell.width,
    cellHeight: cell.height,
    strokes: mine.map((s) => ({
      id: s.id,
      points: s.points.map((p) => [(p[0] - slot.rect.x) * k, (p[1] - slot.rect.y) * k, p[2] ?? 0.5]),
      widthScale: (s.widthScale ?? 1) * k * weight,
    })),
  };
  return { ...out, overflow: overflowOf(out), overflowLimit: OVERFLOW_LIMIT };
}

// The standalone jamo a drawn syllable also contains.
//
// Different from a batchim in one way that makes it easier, not harder: a
// variant cell has to match the shape of the slot it will fill, because that
// shared factor is what keeps the weight even. A standalone jamo matches
// nothing — composition ink-fits it into whichever slot it lands in, and it is
// also typeable on its own as U+3131 and friends. So it wants to fill its cell
// exactly as a hand-drawn one would, which is what this does.
//
// What it therefore does NOT buy is weight: the initial and the vowel already
// composed at ~100%, and they still go through the same fit afterwards. What
// it buys is the drawing — 19 of the 24 jamo fall out of the practice sheet
// (14 consonants, and the five upright vowels it rotates through), so they
// need never be drawn twice.
export function harvestJamo(
  slots: HarvestSlot[],
  strokes: HarvestStroke[],
  assignment: Record<string, SlotKey>,
  basics: readonly string[],
  targetWidth: number,
  targetHeight: number
): HarvestResult[] {
  const out: HarvestResult[] = [];
  const target = emBox(targetWidth, targetHeight);
  for (const slot of slots) {
    // The batchim has its own home; a compound (ㄲ, ㄺ, ㅘ) is two basics
    // written side by side and lifting it whole would put a pair into a cell
    // meant for one shape.
    if (slot.key === "final" || !basics.includes(slot.base)) continue;
    const mine = strokes.filter((s) => assignment[s.id] === slot.key);
    if (mine.length === 0) continue;
    const ink = bounds(mine.flatMap((s) => s.points));
    const w = ink.xmax - ink.xmin;
    const h = ink.ymax - ink.ymin;
    if (w <= 0 && h <= 0) continue;
    // Fill the cell the way a drawn jamo does, with the same air around it
    // the em box already implies.
    const fill = 0.9;
    const scale = Math.min(w > 0 ? (target.size * fill) / w : Infinity, h > 0 ? (target.size * fill) / h : Infinity);
    const dx = target.x + (target.size - w * scale) / 2 - ink.xmin * scale;
    const dy = target.y + (target.size - h * scale) / 2 - ink.ymin * scale;
    const one = {
      name: slot.base,
      role: "fin" as JamoRole, // unused for a standalone jamo; the name is the whole identity
      base: slot.base,
      cellWidth: targetWidth,
      cellHeight: targetHeight,
      strokes: mine.map((s) => ({
        id: s.id,
        points: s.points.map((p) => [p[0] * scale + dx, p[1] * scale + dy, p[2] ?? 0.5]),
        // Thickness travels with the geometry, exactly as in harvestSlot —
        // otherwise a jamo scaled up to fill its cell arrives too thin.
        widthScale: (s.widthScale ?? 1) * scale,
      })),
    };
    // The overflow is measured against the SLOT the ink came out of, not the
    // cell it went into — and that difference is the whole guard here.
    //
    // A variant is mapped rigidly into its cell, so ink that came from the
    // wrong slot lands outside the cell and the check after the fact sees it.
    // A jamo is FITTED: whatever it was given is scaled to fill the cell, so
    // by construction nothing ever sticks out. Measuring the result would
    // report 0 for every case, including the one that brought this up — a
    // batchim stroke that voted for the vowel's slot travelled into the vowel
    // cell, the fit shrank the pair to make room, and out came a ㅕ with a bar
    // under it. Against the slot that stray bar is a mile wide, and it is held
    // back with everything else that spills.
    const local = {
      cellWidth: slot.rect.w,
      cellHeight: slot.rect.h,
      strokes: mine.map((s) => ({
        id: s.id,
        points: s.points.map((p) => [p[0] - slot.rect.x, p[1] - slot.rect.y, p[2] ?? 0.5]),
      })),
    };
    out.push({ ...one, overflow: overflowOf(local), overflowLimit: SLOT_OVERFLOW_LIMIT });
  }
  return out;
}

// Everything harvestable from one drawn syllable.
export function harvestSyllable(
  char: string,
  strokes: HarvestStroke[],
  cellWidth: number,
  cellHeight: number,
  cellSize: number,
  assignment?: Record<string, SlotKey>,
  weight = 1
): HarvestResult[] {
  const slots = harvestSlots(char, cellWidth, cellHeight);
  const map = assignment ?? assignStrokes(slots, strokes);
  return slots
    .map((slot) => harvestSlot(slot, strokes, map, cellSize, weight))
    .filter((r): r is HarvestResult => r !== null);
}
