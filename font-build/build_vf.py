"""VF-Spike Stufe 2: vf-masters.json -> fontane-vf.ttf (echtes Variable Font).

Drei Achsen aus EINEM gezeichneten Skelett:
  wght (100..400..900)  - Strichbreite: eigene perfect-freehand-Renders
                          (thin/bold aus gen-vf-masters.mjs)
  wdth (70..100..135)   - Buchstabenbreite: affine x-Skalierung des
                          Default-Masters (Advance skaliert mit)
  slnt (-12..0..12)     - Neigung: Scherung des Default-Masters um die
                          Baseline (+12 = lehnt nach rechts)

Kalibrierung gespiegelt aus build_ttf.py (guide_transform/bbox_transform),
aber bewusst NUR vom Default-Master berechnet und identisch auf thin/bold
angewendet - sonst wuerde die per-Master-Bbox-Normalisierung genau den
Gewichtsunterschied wegskalieren, den die Achse zeigen soll.

Kein Union: jeder Stroke ist eine eigene, ggf. ueberlappende Kontur;
OVERLAP_SIMPLE wird gesetzt (TrueType-Rasterizer rendern das sauber).

Usage: python3 build_vf.py [vf-masters.json] [fontane-vf.ttf]
"""

import json
import math
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import flagOverlapSimple
from fontTools.ttLib.tables.TupleVariation import TupleVariation

UPM = 1000
ASCENT = 800
DESCENT = -200
SIDE_BEARING = 40
TARGET_GLYPH_HEIGHT = 700

WDTH_MIN_FACTOR = 0.70
WDTH_MAX_FACTOR = 1.35
SLNT_MAX_DEG = 12.0

FAMILY = "Fontane VF Spike"


def guide_transform(entry, doc_metrics):
    """Wie build_ttf.py: Grid-Guides (Baseline/Ascender + Bearings) -> Font-Space."""
    if doc_metrics is None:
        return None
    lb, rb = entry.get("leftBearing"), entry.get("rightBearing")
    cw, ch = entry.get("cellWidth"), entry.get("cellHeight")
    if lb is None or rb is None or not cw or not ch:
        return None
    baseline_px = doc_metrics["baseline"] * ch
    ascender_px = doc_metrics["ascender"] * ch
    left_px, right_px = lb * cw, rb * cw
    span = baseline_px - ascender_px
    scale = ASCENT / span if span > 0 else 1
    return (
        lambda x: (x - left_px) * scale,
        lambda y: (baseline_px - y) * scale,
        max(round((right_px - left_px) * scale), 1),
    )


def bbox_transform(rings):
    """Fallback ohne Guides: eigene Bbox auf Zielhoehe, wie build_ttf.py."""
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    if not xs:
        return None
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    height = ymax - ymin
    scale = TARGET_GLYPH_HEIGHT / height if height > 0 else 1
    return (
        lambda x: (x - xmin) * scale + SIDE_BEARING,
        lambda y: (ymax - y) * scale,
        max(round((xmax - xmin) * scale + 2 * SIDE_BEARING), 1),
    )


def to_font_space(rings, tx, ty):
    return [[(tx(x), ty(y)) for x, y in ring] for ring in rings]


def flatten(rings):
    return [pt for ring in rings for pt in ring]


def int_deltas(master_pts, default_pts, advance_delta=0):
    """gvar-Koordinaten: Punkt-Deltas + 4 Phantompunkte (Phantom 2 = Advance)."""
    deltas = [(round(mx - dx), round(my - dy)) for (mx, my), (dx, dy) in zip(master_pts, default_pts)]
    deltas += [(0, 0), (round(advance_delta), 0), (0, 0), (0, 0)]
    return deltas


def main():
    here = Path(__file__).parent
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "vf-masters.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else here / "fontane-vf.ttf"

    doc = json.loads(src.read_text())
    metrics = doc.get("metrics")

    glyph_order = [".notdef"]
    glyfs = {}
    hmtx = {".notdef": (600, 0)}
    cmap = {}
    variations = {}
    report = []

    for entry in doc["glyphs"]:
        name = entry["name"]
        cp = int(entry["unicode"].replace("U+", ""), 16)
        default_rings = entry["masters"]["default"]

        transform = guide_transform(entry, metrics) or bbox_transform(default_rings)
        if transform is None:
            continue
        tx, ty, advance = transform

        # Alle drei wght-Masters durch DIESELBE Transformation.
        font_masters = {
            m: to_font_space(entry["masters"][m], tx, ty) for m in ("default", "thin", "bold")
        }
        d_flat = flatten(font_masters["default"])
        counts = {m: len(flatten(r)) for m, r in font_masters.items()}
        if len(set(counts.values())) != 1:
            raise SystemExit(f"FEHLER {name}: Punktzahlen ungleich {counts} - Korrespondenz gebrochen")

        # Basis-Glyph (Default-Master) als Polygon-Konturen.
        pen = TTGlyphPen(None)
        for ring in font_masters["default"]:
            pen.moveTo((round(ring[0][0]), round(ring[0][1])))
            for x, y in ring[1:]:
                pen.lineTo((round(x), round(y)))
            pen.closePath()
        glyph = pen.glyph()
        if len(glyph.flags):
            glyph.flags[0] |= flagOverlapSimple
        glyfs[name] = glyph
        hmtx[name] = (advance, round(min(p[0] for p in d_flat)))
        cmap[cp] = name
        glyph_order.append(name)

        # Gerundete Default-Punkte als Referenz, damit Deltas exakt zur
        # tatsaechlich geschriebenen glyf-Geometrie passen.
        d_round = [(round(x), round(y)) for x, y in d_flat]

        tan = math.tan(math.radians(SLNT_MAX_DEG))
        tuples = []
        # wght: echte Re-Renders derselben Centerline.
        tuples.append(TupleVariation({"wght": (-1, -1, 0)}, int_deltas(flatten(font_masters["thin"]), d_round)))
        tuples.append(TupleVariation({"wght": (0, 1, 1)}, int_deltas(flatten(font_masters["bold"]), d_round)))
        # wdth: affine x-Skalierung des Defaults, Advance skaliert mit.
        for peak, f in ((( -1, -1, 0), WDTH_MIN_FACTOR), ((0, 1, 1), WDTH_MAX_FACTOR)):
            scaled = [(x * f, y) for x, y in d_round]
            tuples.append(TupleVariation({"wdth": peak}, int_deltas(scaled, d_round, advance * (f - 1))))
        # slnt: Scherung um die Baseline (y=0 im Font-Space), Advance bleibt.
        for peak, sign in (((0, 1, 1), 1.0), ((-1, -1, 0), -1.0)):
            sheared = [(x + y * tan * sign, y) for x, y in d_round]
            tuples.append(TupleVariation({"slnt": peak}, int_deltas(sheared, d_round)))
        variations[name] = tuples
        report.append((name, len(font_masters["default"]), counts["default"], advance))

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    pen = TTGlyphPen(None)
    glyfs[".notdef"] = pen.glyph()
    fb.setupGlyf(glyfs)
    fb.setupHorizontalMetrics(hmtx)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({"familyName": FAMILY, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT)
    fb.setupPost()
    fb.setupFvar(
        axes=[
            ("wght", 100, 400, 900, "Weight"),
            ("wdth", 70, 100, 135, "Width"),
            ("slnt", -12, 0, 12, "Slant"),
        ],
        instances=[],
    )
    fb.setupGvar(variations)
    fb.save(str(out))

    print(f"OK -> {out} ({out.stat().st_size} bytes)")
    for name, contours, points, advance in report:
        print(f"  {name}: {contours} Konturen, {points} Punkte/Master identisch, advance {advance}, 6 gvar-Tuples")


if __name__ == "__main__":
    main()
