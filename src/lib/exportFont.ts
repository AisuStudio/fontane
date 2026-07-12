import { Font, Glyph, Path } from "opentype.js";

// Mirrors font-build/build_ttf.py's glyph naming/metrics/cmap conventions, but
// the actual binary output differs: opentype.js always writes a CFF-flavored
// OTF (it converts our quadratic contours to cubic internally), where the
// Python script writes a real TrueType glyf table. Both are valid, importable
// fonts — this one's just .otf, not .ttf.
const UPM = 1000;
const ASCENT = 800;
const DESCENT = -200;
const DEFAULT_ADVANCE = 600;
const SIDE_BEARING = 40;

type CompiledGlyph = {
  name: string;
  kind: "base" | "ligature" | "alternate";
  unicode?: string;
  components?: string[];
  alternateOf?: string;
  contours: string[];
};

type CompiledDocument = {
  version: number;
  glyphs: CompiledGlyph[];
};

const TOKEN_RE = /[MQZ]|-?\d+(?:\.\d+)?/g;

// Feeds one "M x y Q cx cy x y Q ... Z" path string (src/lib/contour.ts output)
// into an opentype.js Path — same parser shape as build_ttf.py's regex tokenizer.
function addContourToPath(path: Path, d: string) {
  const tokens = d.match(TOKEN_RE) ?? [];
  let i = 0;
  let started = false;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M") {
      path.moveTo(Number(tokens[i + 1]), Number(tokens[i + 2]));
      started = true;
      i += 3;
    } else if (tok === "Q") {
      path.quadraticCurveTo(
        Number(tokens[i + 1]),
        Number(tokens[i + 2]),
        Number(tokens[i + 3]),
        Number(tokens[i + 4])
      );
      i += 5;
    } else {
      i += 1;
    }
  }
  if (started) path.close();
}

function glyphNameFor(entry: CompiledGlyph): string {
  if (entry.kind === "ligature" && entry.components?.length) {
    return entry.components.join("_") + ".liga";
  }
  return entry.name;
}

export function buildFont(doc: CompiledDocument, familyName = "Glypher Sketch"): Font {
  const notdefGlyph = new Glyph({
    name: ".notdef",
    advanceWidth: DEFAULT_ADVANCE,
    path: new Path(),
  });

  const glyphs: Glyph[] = [notdefGlyph];

  for (const entry of doc.glyphs) {
    const path = new Path();
    for (const d of entry.contours) addContourToPath(path, d);

    const bounds = path.getBoundingBox();
    const advanceWidth = bounds.isEmpty()
      ? DEFAULT_ADVANCE
      : Math.max(Math.round(bounds.x2 + SIDE_BEARING), 1);

    const unicodes =
      entry.kind === "base" && entry.unicode
        ? [parseInt(entry.unicode.replace("U+", ""), 16)]
        : undefined;

    glyphs.push(
      new Glyph({
        name: glyphNameFor(entry),
        unicodes,
        advanceWidth,
        path,
      })
    );
  }

  return new Font({
    familyName,
    styleName: "Regular",
    unitsPerEm: UPM,
    ascender: ASCENT,
    descender: DESCENT,
    glyphs,
  });
}

export function downloadFont(doc: CompiledDocument, fileName = "glypher.otf") {
  const font = buildFont(doc);
  const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
