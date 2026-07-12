# glypher

A web/PWA tool for capturing hand lettering (Apple Pencil, Wacom, mouse/trackpad as fallback — the Pointer Events API is device-agnostic) and turning it into a font with contextual alternates.

## Pipeline

1. **Capture** — pointer position + pressure
2. **Live-render** — variable stroke width
3. **Review & tag** — free writing, manual lasso-select + glyph/ligature assignment (no automatic handwriting recognition, by design)
4. **Outline generation** — centerline + pressure → Bezier contour

All of the above feed a shared, editable JSON document. From there export branches two ways:

- **Glyphs bridge** (full Glyphs license only — Glyphs Mini doesn't support plugins/SVG import): SVG + generated `.fea` code, synced via an iCloud Drive folder, auto-imported by a Glyphs Python plugin.
- **Direct compile** (Glyphs Mini or no license): a small backend calls `fontTools`/`ufo2ft` to compile the JSON straight to OTF/TTF/WOFF2.

Design tokens come from [waffle](https://github.com/AisuStudio/waffle).

## Status

Phase 0 — spike: pointer capture + pressure, testing device/browser support before building the real capture UI.

## Development

```bash
npm run dev
```
