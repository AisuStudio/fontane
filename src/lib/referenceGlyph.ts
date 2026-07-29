import type { Metrics } from "./metrics";

// A faint backdrop letterform drawn behind a Grid cell's own guides/ink — an
// orientation aid for users unsure what a character's basic anatomy looks
// like before drawing their own design over it. Deliberately a system font,
// not the glyph set being designed: a backdrop that already looked like the
// user's own style would blur into their strokes instead of orienting them.
// Comic Sans is a strong default here specifically because of that contrast —
// nobody mistakes it for the thing they're drawing.
export const REFERENCE_FONT_STACK = "'Comic Sans MS', 'Comic Sans', cursive";
export const REFERENCE_COLOR = "#9e9c95"; // hazelnut — same family as GUIDE_COLOR

// Ink-top / font-size, measured once per session on 'H' (cap reference) and
// 'x' (x-height reference) at an arbitrary large test size, then reused as a
// constant ratio for every glyph — cheaper than re-measuring per character,
// and the ratio doesn't depend on font-size in the first place.
const TEST_SIZE = 200;
let capRatio: number | null = null;
let xRatio: number | null = null;

function calibrate(ctx: CanvasRenderingContext2D) {
  if (capRatio !== null && xRatio !== null) return;
  const prevFont = ctx.font;
  ctx.font = `${TEST_SIZE}px ${REFERENCE_FONT_STACK}`;
  capRatio = ctx.measureText("H").actualBoundingBoxAscent / TEST_SIZE;
  xRatio = ctx.measureText("x").actualBoundingBoxAscent / TEST_SIZE;
  ctx.font = prevFont;
}

// Renders `char` faded behind whatever else draws on top, sized so its own
// ink-top lands on the x-height guide (lowercase-with-a-case letters) or the
// ascender guide (uppercase, digits, punctuation, caseless characters) — the
// same case-aware calibration used to merge donor glyphs into a font, just
// done live against THIS cell's own metrics fractions instead of baked into
// font units once.
export function drawReferenceGlyph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  metrics: Metrics,
  leftBearing: number,
  rightBearing: number,
  char: string
) {
  if (!char || char.length !== 1) return;
  calibrate(ctx);
  if (!capRatio || !xRatio) return;

  const baseY = metrics.baseline * height;
  const ascY = metrics.ascender * height;
  const xHeightY = metrics.xHeight * height;
  const isLower = char.toLowerCase() === char && char.toUpperCase() !== char;
  const targetTop = isLower ? baseY - xHeightY : baseY - ascY;
  const ratio = isLower ? xRatio : capRatio;
  if (targetTop <= 0) return;
  const fontSize = targetTop / ratio;

  ctx.save();
  ctx.font = `${fontSize}px ${REFERENCE_FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = REFERENCE_COLOR;
  ctx.globalAlpha = 0.4;
  ctx.fillText(char, ((leftBearing + rightBearing) / 2) * width, baseY);
  ctx.restore();
}
