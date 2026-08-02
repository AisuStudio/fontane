#!/usr/bin/env python3
"""Malt eine eigene pinke Eisengolem-Textur (128x128, RGBA) von Grund auf.

Kein Mojang-Asset wird gelesen oder umgefaerbt — nur das UV-*Layout* des
Vanilla-Modells wird nachgebaut (Boxen unten), damit die Textur auf das
Entity passt. Nur Python-Stdlib (eigener PNG-Writer via zlib).

Output in out/:
  iron_golem.png       — die eigentliche Entity-Textur (128x128)
  texture_preview.png  — 8x-Vorschau des Sheets
  golem_preview.png    — zusammengesetzte Frontansicht (8x)
"""

import struct
import zlib
from pathlib import Path

W = H = 128
OUT = Path(__file__).parent / "out"

# ---------------------------------------------------------------- PNG writer


def write_png(path: Path, pixels, width, height):
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *pixels[y][x]) for x in range(width))
        for y in range(height)
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# ------------------------------------------------------- UV layout (Vanilla)

# (name, u, v, breite, hoehe, tiefe) — Java IronGolemModel / Bedrock-Geometrie
BOXES = [
    ("head", 0, 0, 8, 10, 8),
    ("nose", 24, 0, 2, 4, 2),
    ("body", 0, 40, 18, 12, 11),
    ("skirt", 0, 70, 9, 5, 6),
    ("right_arm", 60, 21, 4, 30, 6),
    ("left_arm", 60, 58, 4, 30, 6),
    ("right_leg", 37, 0, 6, 16, 5),
    ("left_leg", 60, 0, 6, 16, 5),
]


def faces(u, v, w, h, d):
    """Standard-Box-UV: top/bottom oben, dann right/front/left/back."""
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "right": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "left": (u + d + w, v + d, d, h),
        "back": (u + d + w + d, v + d, w, h),
    }


def check_layout():
    rects = []
    for name, u, v, w, h, d in BOXES:
        for fname, (x, y, fw, fh) in faces(u, v, w, h, d).items():
            assert 0 <= x and 0 <= y and x + fw <= W and y + fh <= H, (
                f"{name}/{fname} ragt aus dem 128x128-Sheet"
            )
            rects.append((name, fname, x, y, fw, fh))
    # Nose darf im ungenutzten Kopf-Eck liegen, sonst keine Ueberlappungen.
    for i, (n1, f1, x1, y1, w1, h1) in enumerate(rects):
        for n2, f2, x2, y2, w2, h2 in rects[i + 1 :]:
            if n1 == n2:
                continue
            if {n1, n2} == {"head", "nose"}:
                continue
            overlap = x1 < x2 + w2 and x2 < x1 + w1 and y1 < y2 + h2 and y2 < y1 + h1
            assert not overlap, f"UV-Kollision: {n1}/{f1} vs {n2}/{f2}"


# ----------------------------------------------------------------- Palette

BASE = (242, 178, 196, 255)
LIGHT = (250, 205, 218, 255)
MID = (226, 152, 176, 255)
DARK = (196, 118, 146, 255)
SEAM = (168, 94, 122, 255)
CRACK = (140, 70, 100, 255)
EYE = (66, 30, 44, 255)
EYE_RED = (214, 64, 78, 255)
VINE = (96, 150, 70, 255)
VINE_DK = (66, 110, 50, 255)
FLOWER = (208, 62, 62, 255)
FLOWER_C = (234, 202, 96, 255)


def hash01(x, y, seed=0):
    n = (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF


# ----------------------------------------------------------------- Painting

img = [[(0, 0, 0, 0)] * W for _ in range(H)]


def px(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        img[y][x] = c


def paint_face(x, y, fw, fh, seed):
    for fy in range(fh):
        for fx in range(fw):
            v = hash01(x + fx, y + fy, seed)
            c = LIGHT if v > 0.82 else MID if v < 0.16 else BASE
            edge = fx == 0 or fy == 0 or fx == fw - 1 or fy == fh - 1
            if edge and hash01(x + fx, y + fy, seed + 7) < 0.55:
                c = DARK
            px(x + fx, y + fy, c)


def crack(x, y, points):
    for cx, cy in points:
        px(x + cx, y + cy, CRACK)


def paint():
    for i, (name, u, v, w, h, d) in enumerate(BOXES):
        for (fx, fy, fw, fh) in faces(u, v, w, h, d).values():
            paint_face(fx, fy, fw, fh, seed=i + 1)

    # Kopf-Front (8x10 @ 8,8): Brauen, Augen, roter Blick
    hx, hy = 8, 8
    for fx in (1, 2, 5, 6):
        px(hx + fx, hy + 2, SEAM)          # Braue
        px(hx + fx, hy + 3, EYE)           # Auge
    px(hx + 2, hy + 3, EYE_RED)
    px(hx + 5, hy + 3, EYE_RED)
    crack(hx, hy, [(0, 6), (1, 7), (1, 8)])

    # Nase-Front (2x4 @ 26,2): dunkler, Spitze am dunkelsten
    for fy in range(4):
        for fx in range(2):
            px(26 + fx, 2 + fy, DARK if fy < 3 else SEAM)

    # Koerper-Front (18x12 @ 11,51): Ranke rechts, Bluete links oben, Risse
    bx, by = 11, 51
    vine_path = [(4, 0), (4, 1), (3, 2), (3, 3), (4, 4), (4, 5), (5, 6), (5, 7),
                 (4, 8), (4, 9), (3, 10), (3, 11)]
    for cx, cy in vine_path:
        px(bx + cx, by + cy, VINE)
    for cx, cy in [(2, 3), (5, 5), (2, 10)]:
        px(bx + cx, by + cy, VINE_DK)       # Blaetter
    for cx, cy in [(13, 2), (12, 3), (14, 3), (13, 4)]:
        px(bx + cx, by + cy, FLOWER)        # Bluetenblaetter
    px(bx + 13, by + 3, FLOWER_C)           # Bluetenmitte
    crack(bx, by, [(9, 11), (10, 10), (10, 9), (16, 0), (16, 1), (15, 2)])

    # Arme: je ein langer Riss
    crack(66, 27, [(1, 6), (1, 7), (2, 8), (2, 9), (1, 10), (2, 20), (2, 21), (1, 22)])
    crack(66, 64, [(2, 4), (1, 5), (1, 6), (2, 7), (1, 17), (1, 18), (2, 19)])

    # Beine: Risse an den Schienbeinen
    crack(42, 5, [(2, 5), (2, 6), (3, 7), (3, 8), (1, 12), (1, 13)])
    crack(65, 5, [(3, 4), (2, 5), (2, 6), (4, 11), (4, 12)])


# ----------------------------------------------------------------- Previews


def upscale(pixels, width, height, f):
    return [
        [pixels[y // f][x // f] for x in range(width * f)]
        for y in range(height * f)
    ]


def blit(dst, src_rect, dx, dy):
    sx, sy, sw, sh = src_rect
    for y in range(sh):
        for x in range(sw):
            c = img[sy + y][sx + x]
            if c[3]:
                dst[dy + y][dx + x] = c


def build_figure():
    """Frontansicht aus den Front-Faces zusammensetzen (26x38)."""
    fw, fh = 26, 38
    fig = [[(0, 0, 0, 0)] * fw for _ in range(fh)]
    f = {name: faces(u, v, w, h, d) for name, u, v, w, h, d in BOXES}
    blit(fig, f["right_arm"]["front"], 0, 7)
    blit(fig, f["left_arm"]["front"], 22, 7)
    blit(fig, f["right_leg"]["front"], 7, 21)
    blit(fig, f["left_leg"]["front"], 13, 21)
    blit(fig, f["skirt"]["front"], 8, 22)
    blit(fig, f["body"]["front"], 4, 10)
    blit(fig, f["head"]["front"], 9, 0)
    blit(fig, f["nose"]["front"], 12, 7)
    return fig, fw, fh


def main():
    check_layout()
    paint()
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "iron_golem.png", img, W, H)
    write_png(OUT / "texture_preview.png", upscale(img, W, H, 8), W * 8, H * 8)
    fig, fw, fh = build_figure()
    write_png(OUT / "golem_preview.png", upscale(fig, fw, fh, 8), fw * 8, fh * 8)
    print("ok: iron_golem.png, texture_preview.png, golem_preview.png")


if __name__ == "__main__":
    main()
