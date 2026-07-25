import { DEFAULT_NIB } from "./calligraphy";

export type StrokeMode = "mono" | "dynamic";

export type StrokeSettings = {
  mode: StrokeMode;
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  // The Calligraphy tool's broad nib (see src/lib/calligraphy.ts). Kept
  // alongside the pen/brush settings rather than in a store of its own so one
  // load/save covers every drawing tool — the four fields above simply don't
  // apply to a nib, and these three don't apply to the pen. loadSettings's
  // spread over DEFAULT_SETTINGS is what migrates projects saved before the
  // nib existed.
  nibSize: number;
  nibRatio: number;
  nibAngle: number;
};

export const DEFAULT_SETTINGS: StrokeSettings = {
  mode: "dynamic",
  size: 20,
  thinning: 0.7,
  smoothing: 0.5,
  streamline: 0.5,
  nibSize: DEFAULT_NIB.size,
  nibRatio: DEFAULT_NIB.ratio,
  nibAngle: DEFAULT_NIB.angle,
};

const STORAGE_KEY = "fontane.settings.v1";
const LEGACY_STORAGE_KEY = "glypher.settings.v1"; // pre-rename data, read as a fallback so nothing is lost

export function loadSettings(): StrokeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
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
