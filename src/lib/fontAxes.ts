// Shared axis math for the VF lab's live preview (VfLab.tsx) AND the static
// instance export (vfExport.ts) — centralized so the two can never drift:
// what an instance's file looks like should match what the slider already
// showed for that same wght value.

// wght 100..400..900 → pen-size factor 0.45..1..1.9. Piecewise around 400
// (the drawn default) rather than one linear ramp, so "Regular" always maps
// to exactly 1x — the glyphs as actually drawn, not a rescaled approximation.
export function wghtFactor(wght: number): number {
  return wght <= 400 ? 0.45 + (wght - 100) * (0.55 / 300) : 1 + (wght - 400) * (0.9 / 500);
}
