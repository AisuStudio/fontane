#!/usr/bin/env python3
"""Verpackt out/iron_golem.png als Resource Pack fuer beide Editionen.

  out/PinkGolem-java.zip — Java Edition (resourcepacks/-Ordner)
  out/PinkGolem.mcpack   — Bedrock/Mobile (Datei antippen -> importiert sich)

UUIDs deterministisch via uuid5, damit der Build reproduzierbar ist.
"""

import json
import uuid
import zipfile
from pathlib import Path

OUT = Path(__file__).parent / "out"
DESC = "Pinker Eisengolem — Fontane Minecraft-Spike"


def java_pack(png: bytes):
    mcmeta = {
        "pack": {
            "pack_format": 46,
            "supported_formats": {"min_inclusive": 15, "max_inclusive": 99},
            "description": DESC,
        }
    }
    path = OUT / "PinkGolem-java.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack.mcmeta", json.dumps(mcmeta, ensure_ascii=False, indent=2))
        z.writestr("assets/minecraft/textures/entity/iron_golem/iron_golem.png", png)
    return path


def bedrock_pack(png: bytes):
    ns = uuid.NAMESPACE_URL
    manifest = {
        "format_version": 2,
        "header": {
            "name": "Pink Golem",
            "description": DESC,
            "uuid": str(uuid.uuid5(ns, "fontane.studio/pink-golem/header")),
            "version": [1, 0, 0],
            "min_engine_version": [1, 16, 0],
        },
        "modules": [
            {
                "type": "resources",
                "uuid": str(uuid.uuid5(ns, "fontane.studio/pink-golem/resources")),
                "version": [1, 0, 0],
            }
        ],
    }
    path = OUT / "PinkGolem.mcpack"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr("textures/entity/iron_golem.png", png)
    return path


def main():
    png = (OUT / "iron_golem.png").read_bytes()
    for p in (java_pack(png), bedrock_pack(png)):
        print(f"ok: {p.name} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
