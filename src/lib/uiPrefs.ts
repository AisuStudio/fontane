// Per-section open/closed state for the settings palette's collapsible
// sections (SettingsSection.tsx) — ONE key holding an id→boolean map rather
// than a key per section, so adding a section never grows the localStorage
// namespace. Same typeof-window guards as the sibling loaders (settings.ts).
const STORAGE_KEY = "fontane.settingsSections.v1";

function readAll(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function loadSectionOpen(id: string, fallback: boolean): boolean {
  const all = readAll();
  return typeof all[id] === "boolean" ? all[id] : fallback;
}

export function saveSectionOpen(id: string, open: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [id]: open }));
}
