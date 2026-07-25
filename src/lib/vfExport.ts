// Static instance export for the VF lab: takes the same drawn strokes the
// live wght/wdth/slnt preview (VfLab.tsx) uses, and instead of redrawing a
// canvas, compiles each instance straight into a real, independent OTF via
// the existing exportFont.ts pipeline. Deliberately narrower than page.tsx's
// compileDocument(): strokes only, no Vector-tool shapes — the same scope
// VfLab's own preview already has (it never loaded vectorShapes either), so
// this doesn't introduce a new gap, just matches the existing one.
import { outlineToPath, outlineToSharpPath, unionOutlines, pathToSvgD } from "./contour";
import { applyBrush, applyCalligraphy, type BrushOptions, type BrushOutput } from "./brush";
import { type Nib } from "./calligraphy";
import type { Glyph } from "./glyphs";
import type { Stroke, StrokeKind, StrokePoint } from "./strokes";
import type { Metrics } from "./metrics";
import type { StrokeSettings } from "./settings";
import { buildFont, type CompiledDocument } from "./exportFont";
import { saveFile } from "./saveFile";
import { wghtFactor } from "./fontAxes";

export type AxisValues = { wght: number; wdth: number; slnt: number };

function optionsFor(settings: StrokeSettings): BrushOptions {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
    brush: settings.brush,
  };
}

function nibFor(settings: StrokeSettings): Nib {
  return { size: settings.nibSize, ratio: settings.nibRatio, angle: settings.nibAngle };
}

function outlineFor(points: StrokePoint[], settings: StrokeSettings, kind: StrokeKind | undefined, seedKey: string): BrushOutput {
  if (kind === "calligraphy") return applyCalligraphy(points, nibFor(settings));
  return applyBrush(points, optionsFor(settings), seedKey);
}

// wght, then the Scale tool's own per-stroke widthScale — both are pure
// multipliers on the same two fields, so order between them doesn't matter.
function strokeOutline(stroke: Stroke, axisSettings: StrokeSettings): BrushOutput {
  const ws = stroke.widthScale ?? 1;
  const s = ws === 1 ? axisSettings : { ...axisSettings, size: axisSettings.size * ws, nibSize: axisSettings.nibSize * ws };
  return outlineFor(stroke.points, s, stroke.kind, stroke.id);
}

// wdth (horizontal scale) + slnt (shear), pivoting around the glyph's own
// left bearing and the document's shared baseline — same raw-pixel-space
// geometry VfLab's canvas preview applies via ctx.transform, just against
// point data instead of a rendering context. Glyphs with no Grid guide data
// (Free-drawn) pivot around (0, 0): no cross-glyph consistency, but nothing
// comes out sheared backwards either — same fallback spirit as
// exportFont.ts's bboxTransform.
function applyWidthSlant(
  ring: [number, number][],
  wdthFactor: number,
  slntDeg: number,
  leftPx: number,
  baselinePx: number
): [number, number][] {
  if (wdthFactor === 1 && slntDeg === 0) return ring;
  const shear = Math.tan((slntDeg * Math.PI) / 180);
  return ring.map(([x, y]) => [(x - leftPx) * wdthFactor - shear * (y - baselinePx) + leftPx, y]);
}

export function buildInstanceFont(
  glyphs: Glyph[],
  strokes: Stroke[],
  metrics: Metrics,
  settings: StrokeSettings,
  axes: AxisValues,
  familyName: string,
  styleName: string
) {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const f = wghtFactor(axes.wght);
  const axisSettings: StrokeSettings = { ...settings, size: settings.size * f, nibSize: settings.nibSize * f };
  const wdthF = axes.wdth / 100;

  const doc: CompiledDocument = {
    version: 1,
    metrics,
    glyphs: glyphs.map((g) => {
      const glyphStrokes = g.strokeIds.map((id) => byId.get(id)).filter((s): s is Stroke => Boolean(s));
      const polygons = unionOutlines(glyphStrokes.flatMap((s) => strokeOutline(s, axisSettings).polygons));

      const hasGuides = g.leftBearing != null && g.cellWidth && g.cellHeight;
      const leftPx = hasGuides ? g.leftBearing! * g.cellWidth! : 0;
      const baselinePx = hasGuides ? metrics.baseline * g.cellHeight! : 0;
      const rings = polygons.map((ring) => applyWidthSlant(ring, wdthF, axes.slnt, leftPx, baselinePx));

      // Same smooth-vs-sharp call as compileDocument(): non-freehand ink
      // (nib/stipple) keeps its exact corners, freehand ink gets the
      // midpoint-quadratic smoothing that matches how it was actually drawn.
      const sharp = glyphStrokes.some((s) => s.kind !== "calligraphy") && settings.brush.kind !== "freehand";
      return {
        name: g.name,
        kind: g.kind,
        unicode: g.unicode,
        components: g.components,
        alternateOf: g.alternateOf,
        leftBearing: g.leftBearing,
        rightBearing: g.rightBearing,
        cellWidth: g.cellWidth,
        cellHeight: g.cellHeight,
        contours: rings.map((ring) => pathToSvgD(sharp ? outlineToSharpPath(ring) : outlineToPath(ring))),
      };
    }),
  };

  return buildFont(doc, familyName, styleName);
}

const FAMILY_INSTANCES: { styleName: string; wght: number; fileSuffix: string }[] = [
  { styleName: "Light", wght: 300, fileSuffix: "light" },
  { styleName: "Regular", wght: 400, fileSuffix: "regular" },
  { styleName: "Bold", wght: 700, fileSuffix: "bold" },
];

// Sequentially awaited, not fired in parallel — each saveFile() call may open
// its own native save-picker, and awaiting keeps them from racing (and lets
// its own fallback-to-<a-download> kick in per file if a picker call ever
// loses the gesture, rather than the whole batch failing together).
export async function exportInstanceFamily(
  glyphs: Glyph[],
  strokes: Stroke[],
  metrics: Metrics,
  settings: StrokeSettings,
  familyName = "Fontane Sketch"
) {
  for (const { styleName, wght, fileSuffix } of FAMILY_INSTANCES) {
    const font = buildInstanceFont(glyphs, strokes, metrics, settings, { wght, wdth: 100, slnt: 0 }, familyName, styleName);
    const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
    await saveFile(blob, {
      suggestedName: `fontane-${fileSuffix}.otf`,
      mimeType: "font/otf",
      extension: "otf",
      description: "OpenType font",
    });
  }
}
