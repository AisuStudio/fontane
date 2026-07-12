export type Glyph = {
  id: string;
  name: string;
  strokeIds: string[];
  createdAt: number;
};

const STORAGE_KEY = "glypher.glyphs.v1";

export function loadGlyphs(): Glyph[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveGlyphs(glyphs: Glyph[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(glyphs));
}

export function clearGlyphs() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
