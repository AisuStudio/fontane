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
  DEFAULT_LAYOUT,
  JAMO_VARIANTS,
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

  const layout = DEFAULT_LAYOUT[cls];
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
  if (cls === "V") return "initV";
  if (cls === "H") return "initH";
  return null;
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

function inside(r: Rect, x: number, y: number) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
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
export function assignStrokes(slots: HarvestSlot[], strokes: HarvestStroke[]): Record<string, SlotKey> {
  const out: Record<string, SlotKey> = {};
  if (slots.length === 0) return out;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    let best: SlotKey | null = null;
    let bestScore = 0;
    for (const slot of slots) {
      let hits = 0;
      for (const p of stroke.points) if (inside(slot.rect, p[0], p[1])) hits++;
      const score = hits / stroke.points.length;
      if (score > bestScore) {
        bestScore = score;
        best = slot.key;
      }
    }
    if (!best) {
      const b = bounds(stroke.points);
      const cx = (b.xmin + b.xmax) / 2;
      const cy = (b.ymin + b.ymax) / 2;
      let nearest = slots[0];
      let nearestD = Infinity;
      for (const slot of slots) {
        const dx = slot.rect.x + slot.rect.w / 2 - cx;
        const dy = slot.rect.y + slot.rect.h / 2 - cy;
        const d = dx * dx + dy * dy;
        if (d < nearestD) {
          nearestD = d;
          nearest = slot;
        }
      }
      best = nearest.key;
    }
    out[stroke.id] = best;
  }
  return out;
}

export type HarvestResult = {
  name: string; // e.g. "ㄱ.fin"
  role: JamoRole;
  base: string;
  cellWidth: number;
  cellHeight: number;
  strokes: HarvestStroke[];
};

// The cell a harvested variant lands in, in pixels. Both dimensions come from
// the variant's own slot fractions against one shared cellSize, which is what
// makes every variant cell map onto its slot by the SAME factor — and that
// shared factor IS the even stroke weight. Do not "fix" this by giving the
// cells a common width.
export function variantCellSize(role: JamoRole, cellSize: number): { width: number; height: number } {
  const v = JAMO_VARIANTS.find((x) => x.role === role);
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
// `lighten` is the one deliberate departure: real Korean faces do take a
// little weight out of a dense batchim so the syllable doesn't clot, on the
// order of 5-15%. Default 1 (none) — it is a design decision, not a default.
export function harvestSlot(
  slot: HarvestSlot,
  strokes: HarvestStroke[],
  assignment: Record<string, SlotKey>,
  cellSize: number,
  lighten = 1
): HarvestResult | null {
  if (!slot.role) return null;
  const mine = strokes.filter((s) => assignment[s.id] === slot.key);
  if (mine.length === 0) return null;

  const cell = variantCellSize(slot.role, cellSize);
  const k = cell.width / slot.rect.w;

  return {
    name: variantName(slot.base, slot.role),
    role: slot.role,
    base: slot.base,
    cellWidth: cell.width,
    cellHeight: cell.height,
    strokes: mine.map((s) => ({
      id: s.id,
      points: s.points.map((p) => [(p[0] - slot.rect.x) * k, (p[1] - slot.rect.y) * k, p[2] ?? 0.5]),
      widthScale: (s.widthScale ?? 1) * k * lighten,
    })),
  };
}

// Everything harvestable from one drawn syllable.
export function harvestSyllable(
  char: string,
  strokes: HarvestStroke[],
  cellWidth: number,
  cellHeight: number,
  cellSize: number,
  assignment?: Record<string, SlotKey>,
  lighten = 1
): HarvestResult[] {
  const slots = harvestSlots(char, cellWidth, cellHeight);
  const map = assignment ?? assignStrokes(slots, strokes);
  return slots
    .map((slot) => harvestSlot(slot, strokes, map, cellSize, lighten))
    .filter((r): r is HarvestResult => r !== null);
}
