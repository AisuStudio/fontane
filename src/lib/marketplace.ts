import { parse as parseFont } from "opentype.js";

// Shared between the publish/download route and both marketplace pages so
// the Storage URL shape lives in exactly one place.
export function publicFontUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fonts/${slug}.otf`;
}

// Fixed specimen line shown wherever a published font is previewed (overview
// page, browse cards) — always the same phrase so fonts are easy to compare
// side by side, same idea as Google Fonts' pangram cards.
export const SAMPLE_TEXT = "Quick brown Jox fumps over the dazy Log";

export type FontGlyphSpecimen = { name: string; d: string; advanceWidth: number };
export type FontGlyphSheet = {
  // Characters the font can render from ordinary text — no outline data at
  // all, because the page just sets them in the font itself.
  chars: string[];
  charsTotal: number;
  // Glyphs with no codepoint (ligatures, alternates). These genuinely cannot
  // be reached by typing, which is the entire reason this sheet exists, and
  // they're the only ones that need their outline shipped.
  hidden: FontGlyphSpecimen[];
  hiddenTotal: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
};

// How much of each list the page gets. Both are display limits, not
// correctness limits — the totals travel alongside so the page can say what
// it isn't showing instead of quietly truncating.
const CHAR_CAP = 500;
const HIDDEN_CAP = 150;

// Server-side only (fetches the published binary directly).
//
// This used to walk every glyph and ship every outline as SVG, on the
// reasoning that ligature/alternate glyphs have no cmap entry and can't be
// reached by typing. That reasoning holds for exactly those glyphs — and for
// nothing else. A Korean font is ~2.350 syllables that all have codepoints,
// so the old version shipped several MB of path data per page view to draw
// characters the browser could have rendered itself from the @font-face the
// page already loads.
//
// So: codepoint-carrying glyphs come back as plain characters (a few KB), and
// the outline route is kept for what it was built for. Caching matters for
// the same reason — a published slug is immutable (publish refuses an
// existing name and uploads with upsert:false), so re-downloading and
// re-parsing a multi-MB font on every visit was pure waste.
export async function getFontGlyphSheet(slug: string): Promise<FontGlyphSheet | null> {
  try {
    const res = await fetch(publicFontUrl(slug), { cache: "force-cache" });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const font = parseFont(buffer);
    const unitsPerEm = font.unitsPerEm || 1000;
    const ascender = font.ascender || unitsPerEm * 0.8;
    const descender = font.descender || -unitsPerEm * 0.2;

    // cmap maps codepoint → glyph index; inverted it answers "can this glyph
    // be typed at all". First codepoint wins if several map to one glyph.
    const codepointFor = new Map<number, number>();
    const cmap = font.tables?.cmap?.glyphIndexMap as Record<string, number> | undefined;
    for (const [codepoint, index] of Object.entries(cmap ?? {})) {
      if (!codepointFor.has(index)) codepointFor.set(index, Number(codepoint));
    }

    const typed: number[] = [];
    const hidden: FontGlyphSpecimen[] = [];
    let hiddenTotal = 0;
    // Glyph index 0 is always .notdef — not a real character, skip it.
    for (let i = 1; i < font.glyphs.length; i++) {
      const codepoint = codepointFor.get(i);
      if (codepoint !== undefined) {
        typed.push(codepoint);
        continue; // no outline needed — the page sets this as text
      }
      const g = font.glyphs.get(i);
      if (!g.path || g.path.commands.length === 0) continue; // e.g. space — nothing to draw
      hiddenTotal++;
      if (hidden.length < HIDDEN_CAP) {
        hidden.push({
          name: g.name || `glyph${i}`,
          // Only computed for the handful that need it; doing this for every
          // glyph is what made the Korean page unservable.
          d: g.getPath(0, 0, unitsPerEm).toPathData(1),
          advanceWidth: g.advanceWidth || unitsPerEm * 0.6,
        });
      }
    }

    typed.sort((a, b) => a - b);
    return {
      chars: typed.slice(0, CHAR_CAP).map((cp) => String.fromCodePoint(cp)),
      charsTotal: typed.length,
      hidden,
      hiddenTotal,
      unitsPerEm,
      ascender,
      descender,
    };
  } catch {
    return null;
  }
}
