import { DEFAULT_NIB as DEFAULT_CALLIGRAPHY_NIB } from "./calligraphy";
import { DEFAULT_BRUSH, DEFAULT_NIB, DEFAULT_SCATTER, type BrushSettings } from "./brush";

export type StrokeMode = "mono" | "dynamic";

export type StrokeSettings = {
  mode: StrokeMode;
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  // The Calligraphy tool's broad nib (see src/lib/calligraphy.ts) — a
  // per-stroke applicator picked by drawing with that tool, unlike `brush`
  // below. Kept alongside the pen/brush settings rather than in a store of
  // its own so one load/save covers every drawing tool — the four fields
  // above simply don't apply to a nib, and these three don't apply to the
  // pen. mergeSettings's spread over DEFAULT_SETTINGS is what migrates
  // projects saved before the nib existed.
  nibSize: number;
  nibRatio: number;
  nibAngle: number;
  // Which applicator turns a skeleton into ink (src/lib/brush.ts) for every
  // NON-calligraphy stroke. The four fields above are the freehand brush's
  // own parameters — they predate the brush concept and keep their names, so
  // nothing about an existing project file or a saved setting changes
  // meaning.
  brush: BrushSettings;
  // The Vector (Bezier pen) tool's draw-time default, baked onto each new
  // path the moment its first anchor is placed (mirrors how a Stroke's own
  // `kind` is fixed by whichever tool drew it) — "fill" is today's only
  // behavior (solid letterform / hole-punch), "stroke" instead inks a
  // constant-width outline along the path, open or closed. See
  // VectorShape.renderMode in src/lib/vectorShapes.ts.
  vectorRenderMode: "fill" | "stroke";
  // Canvas px, meaningful only when vectorRenderMode is "stroke".
  vectorStrokeWidth: number;
};

export const DEFAULT_SETTINGS: StrokeSettings = {
  mode: "mono",
  size: 20,
  thinning: 0.7,
  smoothing: 0.5,
  streamline: 0.5,
  nibSize: DEFAULT_CALLIGRAPHY_NIB.size,
  nibRatio: DEFAULT_CALLIGRAPHY_NIB.ratio,
  nibAngle: DEFAULT_CALLIGRAPHY_NIB.angle,
  brush: DEFAULT_BRUSH,
  vectorRenderMode: "fill",
  vectorStrokeWidth: 8,
};

const STORAGE_KEY = "fontane.settings.v1";
const LEGACY_STORAGE_KEY = "glypher.settings.v1"; // pre-rename data, read as a fallback so nothing is lost

// The top-level spread that used to be enough here can't reach into `brush`:
// a settings blob written before a nib/scatter parameter existed would spread
// in a params object missing that field, and the brush would read undefined
// where it expects a number. Merging each params object against its own
// defaults keeps adding a parameter a non-event, exactly as adding a
// top-level setting already was. Exported because applyProjectFile feeds
// settings straight out of an .fff file, which has the same problem.
export function mergeSettings(parsed: Partial<StrokeSettings> | null | undefined): StrokeSettings {
  const brush = parsed?.brush;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    brush: {
      kind: brush?.kind ?? DEFAULT_BRUSH.kind,
      nib: { ...DEFAULT_NIB, ...brush?.nib },
      scatter: { ...DEFAULT_SCATTER, ...brush?.scatter },
    },
  };
}

export function loadSettings(): StrokeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return mergeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: StrokeSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
