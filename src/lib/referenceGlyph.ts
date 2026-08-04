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
  char: string,
  guides: "baseline" | "em" = "baseline"
) {
  if (!char || char.length !== 1) return;

  // Hangul takes a different path entirely rather than a branch inside the
  // Latin one: there is no baseline to sit on, no case to test, and Comic
  // Sans has no Korean coverage at all — the cap/x-height ratios measured
  // off H and x say nothing about a jamo's proportions.
  if (guides === "em") {
    drawReferenceJamo(ctx, width, height, char);
    return;
  }

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

// The Korean counterpart. Same job — a faint backdrop shape to orient
// against — but measured against the em square instead of a baseline, and
// centered in it, which is how a standalone jamo actually sits.
//
// The font stack is a system Korean face rather than something deliberately
// contrasting like Comic Sans: the Latin trick of "pick a face nobody would
// mistake for their own design" has no equivalent here, and coverage matters
// more than contrast — a stack that falls through to tofu is worse than no
// backdrop at all. Low alpha does the separating instead.
const REFERENCE_JAMO_STACK =
  "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'AppleGothic', sans-serif";

// Ink extents per jamo, cached by character. Deliberately NOT one shared
// ratio the way capRatio/xRatio are for Latin: jamo proportions are wildly
// unlike each other — ㅣ is a full-height bar, ㅡ is a flat rule, ㅇ is a
// circle — so a single ratio measured off one of them oversizes or
// undersizes every other. 24 measurements, taken once each.
const jamoInk = new Map<string, { w: number; h: number }>();

function inkFor(ctx: CanvasRenderingContext2D, char: string): { w: number; h: number } | null {
  const cached = jamoInk.get(char);
  if (cached) return cached;
  const prevFont = ctx.font;
  ctx.font = `${TEST_SIZE}px ${REFERENCE_JAMO_STACK}`;
  const m = ctx.measureText(char);
  ctx.font = prevFont;
  const ink = {
    w: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / TEST_SIZE,
    h: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / TEST_SIZE,
  };
  if (!(ink.w > 0) || !(ink.h > 0)) return null;
  jamoInk.set(char, ink);
  return ink;
}

function drawReferenceJamo(ctx: CanvasRenderingContext2D, width: number, height: number, char: string) {
  const ink = inkFor(ctx, char);
  if (!ink) return;

  // The same centered square GridCell's em guides draw, so the backdrop
  // lines up with the box the user is drawing into. Standalone jamo don't
  // fill the em — Korean convention leaves air around them, and a backdrop
  // touching the guide lines would read as a target to trace.
  const target = Math.min(width, height) * 0.72;
  // Fit, don't stretch: whichever axis runs out first sets the size, so a
  // bar stays a bar and a circle stays a circle.
  const fontSize = Math.min(target / ink.w, target / ink.h);

  ctx.save();
  ctx.font = `${fontSize}px ${REFERENCE_JAMO_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = REFERENCE_COLOR;
  ctx.globalAlpha = 0.4;
  ctx.fillText(char, width / 2, height / 2);
  ctx.restore();
}
