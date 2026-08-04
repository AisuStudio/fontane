#!/usr/bin/env python3
"""Compiles a fontane-document.json (Export tab -> Download JSON in the
Fontane web app) into a real .ttf font.

No UFO / ufo2ft involved: Fontane's exported SVG paths are already
quadratic (M/Q/Z, see src/lib/contour.ts), which is exactly what TrueType's
glyf table stores natively. So this builds the glyf table directly from the
parsed path data via fontTools' low-level FontBuilder + TTGlyphPen, instead
of round-tripping through a UFO and a cubic-curve compiler.

Usage:
    python3 build_ttf.py fontane-document.json output.ttf
"""

import json
import re
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import UNSCALED_COMPONENT_OFFSET

UPM = 1000
ASCENT = 800
DESCENT = -200
DEFAULT_ADVANCE = 600
SIDE_BEARING = 40
# Canvas strokes are drawn at whatever pixel size the user happened to use, with
# no notion of "cap height." Each glyph gets its own drawn bounding box rescaled
# to this height so nothing comes out microscopic or oversized relative to a
# 1000-unit em - a reasonable cap-height-ish target, not a real calibration.
TARGET_GLYPH_HEIGHT = 700
# Mirrors EM_BOX_FRACTION in src/lib/hangul.ts - see em_transform below.
EM_BOX_FRACTION = 0.86

# L is in here because a glyph drawn with a nib or stipple brush emits
# straight-edged contours (src/lib/contour.ts's outlineToSharpPath) instead of
# the midpoint quadratics a freehand outline produces. Without it every L and
# each of its two coordinates fell through to the Z branch below, and those
# glyphs compiled to nothing.
TOKEN_RE = re.compile(r"[MLQZ]|-?\d+(?:\.\d+)?")


def parse_path_commands(d):
    """Parses one 'M x y Q cx cy x y Q ... Z' path string into structured
    commands, kept as data (not fed straight into a pen) so a bounding box can
    be computed before anything gets drawn."""
    tokens = TOKEN_RE.findall(d)
    commands = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "M":
            commands.append(("M", float(tokens[i + 1]), float(tokens[i + 2])))
            i += 3
        elif tok == "L":
            commands.append(("L", float(tokens[i + 1]), float(tokens[i + 2])))
            i += 3
        elif tok == "Q":
            commands.append(
                ("Q", float(tokens[i + 1]), float(tokens[i + 2]), float(tokens[i + 3]), float(tokens[i + 4]))
            )
            i += 5
        else:
            commands.append(("Z",))
            i += 1
    return commands


def bounds_of(contours):
    xs = [c[-2] for cmds in contours for c in cmds if c[0] != "Z"]
    ys = [c[-1] for cmds in contours for c in cmds if c[0] != "Z"]
    if not xs:
        return None
    return min(xs), max(xs), min(ys), max(ys)


def feed_pen(commands, pen, tx, ty):
    """Canvas space is x-right/y-down with no baseline; font space is x-right/
    y-up with y=0 as the baseline. tx/ty carry the actual mapping - either
    guide-based (guide_transform) or the bbox fallback (bbox_transform).
    Applied uniformly to on-curve and control points alike, which is safe -
    an affine transform commutes with quadratic Bezier evaluation."""
    started = False
    for c in commands:
        if c[0] == "M":
            pen.moveTo((tx(c[1]), ty(c[2])))
            started = True
        elif c[0] == "L":
            pen.lineTo((tx(c[1]), ty(c[2])))
        elif c[0] == "Q":
            pen.qCurveTo((tx(c[1]), ty(c[2])), (tx(c[3]), ty(c[4])))
        elif started:
            pen.closePath()


def guide_transform(entry, doc_metrics):
    """Grid View glyphs carry a real calibration: the document's shared
    baseline/ascender fractions plus this glyph's own draggable left/right
    bearings, both resolved against the cell's pixel size at draw time
    (cellWidth/cellHeight - captured once so a later window resize can't
    shift already-drawn glyphs relative to each other)."""
    if doc_metrics is None:
        return None
    left_bearing = entry.get("leftBearing")
    right_bearing = entry.get("rightBearing")
    cell_width = entry.get("cellWidth")
    cell_height = entry.get("cellHeight")
    if left_bearing is None or right_bearing is None or not cell_width or not cell_height:
        return None

    baseline_px = doc_metrics["baseline"] * cell_height
    ascender_px = doc_metrics["ascender"] * cell_height
    left_px = left_bearing * cell_width
    right_px = right_bearing * cell_width

    span = baseline_px - ascender_px
    scale = ASCENT / span if span > 0 else 1

    return (
        lambda x: (x - left_px) * scale,
        lambda y: (baseline_px - y) * scale,
        max(round((right_px - left_px) * scale), 1),
    )


def bbox_transform(contours):
    """Fallback for glyphs with no Grid View guide data (e.g. tagged via
    Write mode's lasso-select): rescale the glyph's own drawn bounding box to
    a fixed cap-height-ish target. No cross-glyph consistency, but nothing
    comes out microscopic, oversized, or upside-down either."""
    bounds = bounds_of(contours)
    if not bounds:
        return None
    xmin, xmax, ymin, ymax = bounds
    height = ymax - ymin
    scale = TARGET_GLYPH_HEIGHT / height if height > 0 else 1
    return (
        lambda x: (x - xmin) * scale + SIDE_BEARING,
        lambda y: (ymax - y) * scale,
        max(round((xmax - xmin) * scale + 2 * SIDE_BEARING), 1),
    )


def em_transform(entry):
    """Hangul's calibration. No baseline: the glyph was drawn inside (or
    composed into) a square em box and maps onto the font's em square - top
    edge at the ascender, bottom one em below, advance exactly one em for
    every syllable. That uniform advance is how Korean is set, not a
    simplification.

    The source square mirrors emBox() in src/lib/hangul.ts, which is also what
    draws the guides in the app - so what the user sees as the em is the box
    that maps onto the font's em. Deliberately smaller than the cell: a jamo
    drawn right up to the edge should overshoot the em slightly rather than
    define it. EM_BOX_FRACTION has to stay in step with that module.
    """
    cell_width = entry.get("cellWidth")
    cell_height = entry.get("cellHeight")
    if not cell_width or not cell_height:
        return None
    size = min(cell_width, cell_height) * EM_BOX_FRACTION
    origin_x = (cell_width - size) / 2
    origin_y = (cell_height - size) / 2
    scale = UPM / size
    return (
        lambda x: (x - origin_x) * scale,
        lambda y: ASCENT - (y - origin_y) * scale,
        UPM,
    )


def glyph_name_for(entry):
    # Match the naming convention the Glyphs import script also uses, so a
    # font built here and a font built via Glyphs.app agree on glyph names.
    if entry.get("kind") == "ligature" and entry.get("components"):
        return "_".join(entry["components"]) + ".liga"
    return entry["name"]


def build_font(doc, family_name="Fontane Sketch"):
    glyph_order = [".notdef"]
    cmap = {}
    glyphs = {}
    metrics = {}
    composite_names = []
    doc_metrics = doc.get("metrics")

    notdef_pen = TTGlyphPen(None)
    glyphs[".notdef"] = notdef_pen.glyph()
    metrics[".notdef"] = (DEFAULT_ADVANCE, 0)

    # Composite syllables have to come second: fontTools resolves a component
    # by glyph name at compile time, so every jamo it points at must already
    # be in `glyphs`. Sorting by "does it have parts" is enough - jamo never
    # have parts, and a syllable never references another syllable.
    entries = sorted(doc.get("glyphs", []), key=lambda e: bool(e.get("hangulParts")))

    for entry in entries:
        name = glyph_name_for(entry)
        pen = TTGlyphPen(glyphs)
        parts = entry.get("hangulParts")

        if parts:
            # A syllable as references to the jamo glyphs rather than copies
            # of their outlines - three component records instead of three
            # duplicated contours, which is the whole reason the full 11.172
            # fit in about a megabyte. The transforms are pure scale+offset
            # (see HangulPart), which is all a TrueType component can carry.
            for part in parts:
                if part["jamo"] not in glyphs:
                    continue  # jamo not drawn - skip rather than emit a half syllable
                pen.addComponent(
                    part["jamo"],
                    (part["xx"], 0, 0, part["yy"], part["dx"], part["dy"]),
                )
            glyph = pen.glyph()
            # Without this flag the spec leaves it to the rasterizer whether a
            # component's offset is scaled by that component's own transform:
            # Microsoft's assumes unscaled, Apple's assumes scaled. Our dx/dy
            # are already in final font units, so on macOS the unflagged font
            # rendered every scaled-down part in the wrong place - most
            # visibly the horizontal vowels, which are squeezed the hardest
            # and so were displaced the furthest. fontTools computes bounds
            # with the unscaled assumption, which is why the glyf table looked
            # correct while the text did not.
            for component in glyph.components:
                component.flags |= UNSCALED_COMPONENT_OFFSET
            glyphs[name] = glyph
            glyph_order.append(name)
            # Left side bearing has to equal the glyph's own xMin, which for a
            # composite only exists once its components have been resolved -
            # so it's filled in after setupGlyf below. Getting this wrong does
            # not misplace the glyph a little: renderers that trust hmtx shift
            # the outline by (lsb - xMin), which for a syllable whose ink
            # starts a third of the way into the em threw whole parts out of
            # the cell.
            composite_names.append(name)
            metrics[name] = (UPM, 0)
            if entry.get("kind") == "base" and entry.get("unicode"):
                cmap[int(entry["unicode"].replace("U+", ""), 16)] = name
            continue

        contours = [parse_path_commands(d) for d in entry.get("contours", [])]
        if entry.get("script") == "hangul":
            transform = em_transform(entry) or bbox_transform(contours)
        else:
            transform = guide_transform(entry, doc_metrics) or bbox_transform(contours)

        advance, lsb = DEFAULT_ADVANCE, 0
        if transform:
            tx, ty, advance_width = transform
            for commands in contours:
                feed_pen(commands, pen, tx, ty)
        glyph = pen.glyph()
        glyphs[name] = glyph
        glyph_order.append(name)

        if glyph.numberOfContours:
            xs = [pt[0] for pt in glyph.coordinates]
            lsb = int(min(xs))
            advance = advance_width if transform else DEFAULT_ADVANCE
        metrics[name] = (max(advance, 1), lsb)

        if entry.get("kind") == "base" and entry.get("unicode"):
            codepoint = int(entry["unicode"].replace("U+", ""), 16)
            cmap[codepoint] = name

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    # setupGlyf resolves each composite and computes its real bounds; only now
    # can a composite's left side bearing be set to its own xMin (see above).
    for name in composite_names:
        glyph = fb.font["glyf"][name]
        metrics[name] = (UPM, getattr(glyph, "xMin", 0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({"familyName": family_name, "styleName": "Regular"})
    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        usWinAscent=ASCENT,
        usWinDescent=-DESCENT,
    )
    fb.setupPost()
    return fb


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 build_ttf.py <fontane-document.json> <output.ttf>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        doc = json.load(f)

    fb = build_font(doc)
    fb.save(sys.argv[2])
    print(f"Wrote {sys.argv[2]} ({len(doc.get('glyphs', []))} glyphs)")


if __name__ == "__main__":
    main()
