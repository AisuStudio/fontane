// VF-Spike Stufe 1: FFF → vf-masters.json
//
// Rendert jede Glyphe DREIMAL aus derselben Centerline (perfect-freehand,
// exakt die App-Parameter): default / thin / bold — die wght-Masters.
// wdth und slnt brauchen KEINE eigenen Renders, die entstehen später in
// build_vf.py als affine Ableitungen des Default-Masters.
//
// Der entscheidende Trick gegen den Union-Blocker: KEINE Polygon-Union.
// Jeder Stroke bleibt eine eigene Kontur (TrueType verträgt Überlappung,
// build_vf.py setzt das OVERLAP_SIMPLE-Flag), und jede Kontur wird auf
// exakt RESAMPLE_POINTS Punkte arc-length-resampled — damit ist die
// Punktkorrespondenz zwischen allen Masters KONSTRUKTIV garantiert statt
// von perfect-freehand-Interna abhängig.
//
// Usage: node gen-vf-masters.mjs <input.fff> [output.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getStroke } from "../node_modules/perfect-freehand/dist/esm/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RESAMPLE_POINTS = 96;

// Muss optionsFor() in src/app/page.tsx spiegeln (gleiche Keys, gleiche
// Defaults — simulatePressure etc. bewusst NICHT gesetzt, damit der Render
// byte-gleich zur App bleibt). factor skaliert nur die Stiftbreite.
//
// Bewusst NUR der Freehand-Brush: dieser Spike lebt davon, dass alle drei
// Masters dieselbe Punktzahl pro Kontur haben (siehe resampleRing und die
// Korrespondenz-Prüfung in build_vf.py). Ein Nib-Brush ließe sich so
// interpolieren, ein Stipple-Brush grundsätzlich nicht — seine Stempelanzahl
// ändert sich mit der Stiftbreite, und damit bricht die Punkt-zu-Punkt-
// Zuordnung, auf der gvar beruht. Bis das entschieden ist, rendert dieses
// Skript jedes .fff als Freehand und sagt das unten laut.
function optionsFor(settings, widthScale, factor) {
  return {
    size: settings.size * (widthScale ?? 1) * factor,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
  };
}

// Geschlossenen Ring auf n äquidistante Punkte (Bogenlänge) resampeln.
// Startpunkt bleibt outline[0] — getStroke startet deterministisch an
// derselben relativen Stelle, das hält die Korrespondenz zwischen Masters.
function resampleRing(outline, n) {
  const pts = outline;
  const count = pts.length;
  if (count < 3) return null;
  const seg = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % count];
    const d = Math.hypot(x1 - x0, y1 - y0);
    seg.push(d);
    total += d;
  }
  if (total === 0) return null;
  const out = [];
  let target = 0;
  let acc = 0;
  let i = 0;
  for (let k = 0; k < n; k++) {
    target = (k / n) * total;
    while (acc + seg[i] < target) {
      acc += seg[i];
      i = (i + 1) % count;
    }
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % count];
    const t = seg[i] > 0 ? (target - acc) / seg[i] : 0;
    out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return out;
}

const MASTERS = { default: 1.0, thin: 0.45, bold: 1.9 };

const inputPath = process.argv[2] ?? join(here, "fixtures", "spike-lo.fff");
const outputPath = process.argv[3] ?? join(here, "vf-masters.json");

const fff = JSON.parse(readFileSync(inputPath, "utf8"));
const fffBrush = fff.settings?.brush?.kind ?? "freehand";
if (fffBrush !== "freehand") {
  console.warn(
    `WARNUNG: ${inputPath} benutzt den "${fffBrush}"-Brush. Dieses Skript rendert trotzdem Freehand ` +
      `(siehe optionsFor oben) — die gebaute VF sieht also anders aus als die App.`
  );
}
const strokesById = new Map(fff.strokes.map((s) => [s.id, s]));

const glyphs = [];
for (const g of fff.glyphs) {
  if (g.kind !== "base" || !g.unicode) continue;
  const strokes = (g.strokeIds ?? []).map((id) => strokesById.get(id)).filter(Boolean);
  if (strokes.length === 0) continue;

  const masters = {};
  let ok = true;
  for (const [master, factor] of Object.entries(MASTERS)) {
    const rings = [];
    for (const s of strokes) {
      const outline = getStroke(s.points, optionsFor(fff.settings, s.widthScale, factor));
      const ring = resampleRing(outline, RESAMPLE_POINTS);
      if (!ring) { ok = false; break; }
      rings.push(ring);
    }
    if (!ok) break;
    masters[master] = rings;
  }
  if (!ok) {
    console.warn(`skip ${g.name}: degenerate stroke`);
    continue;
  }
  glyphs.push({
    name: g.name,
    unicode: g.unicode,
    leftBearing: g.leftBearing ?? null,
    rightBearing: g.rightBearing ?? null,
    cellWidth: g.cellWidth ?? null,
    cellHeight: g.cellHeight ?? null,
    masters,
  });
}

writeFileSync(outputPath, JSON.stringify({ metrics: fff.metrics, resamplePoints: RESAMPLE_POINTS, glyphs }));

for (const g of glyphs) {
  const counts = Object.fromEntries(
    Object.entries(g.masters).map(([m, rings]) => [m, rings.map((r) => r.length).join("+")])
  );
  console.log(`glyph ${g.name}: contours=${g.masters.default.length}`, counts);
}
console.log(`wrote ${outputPath} (${glyphs.length} glyphs, ${RESAMPLE_POINTS} pts/ring, no union)`);
