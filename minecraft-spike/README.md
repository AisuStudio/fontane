# Minecraft-Spike: Pinker Eisengolem (2026-08-02)

Ergebnis: **GRÜN — vorbehaltlich In-Game-Test.** Struktur, JSON, PNG und
UV-Layout sind maschinell geprüft; ob der Golem im Spiel wirklich pink
dasteht, muss einmal manuell bestätigt werden (siehe unten).

Erster Teil des Minecraft-Spikes: eine **eigene, von Grund auf gemalte**
pinke Eisengolem-Textur (kein Mojang-Asset extrahiert oder umgefärbt — nur
das UV-*Layout* des Vanilla-Modells wird nachgebaut, damit die Textur auf
das Entity passt), verpackt als Resource Pack für beide Editionen.

## Dateien

| Datei | Zweck |
|---|---|
| `make_golem_texture.py` | malt `out/iron_golem.png` (128×128) + zwei Vorschauen; prüft dabei alle UV-Boxen auf Sheet-Grenzen und Kollisionen |
| `build_packs.py` | packt daraus `out/PinkGolem-java.zip` (Java) und `out/PinkGolem.mcpack` (Bedrock/Mobile) |
| `out/` | generierte Artefakte (reproduzierbar: beide Skripte sind deterministisch, UUIDs via uuid5) |

Neu bauen: `python3 make_golem_texture.py && python3 build_packs.py` (nur Stdlib).

## Installation

**Handy / Konsole (Bedrock):** `PinkGolem.mcpack` aufs Gerät laden und
antippen — Minecraft importiert das Pack selbst. Dann in den
Welt-Einstellungen unter *Ressourcenpakete* aktivieren.

**PC (Java Edition):** `PinkGolem-java.zip` in den `resourcepacks/`-Ordner
legen (im Spiel: Optionen → Ressourcenpakete → Packordner öffnen), Pack
aktivieren. `pack_format` 46 mit `supported_formats` 15–99 — ältere/neuere
Versionen zeigen höchstens eine Kompatibilitätswarnung, laden aber.

## Wie es funktioniert

Entity-Texturen sind ein 128×128-Sheet; jede Quader-Box des Modells liest
ihre sechs Faces an festen UV-Offsets (Kopf `(0,0)` 8×10×8, Nase `(24,0)`,
Körper `(0,40)` 18×12×11, Schurz `(0,70)`, Arme `(60,21)`/`(60,58)` 4×30×6,
Beine `(37,0)`/`(60,0)` 6×16×5). `make_golem_texture.py` asserted, dass alle
Face-Rechtecke ins Sheet passen und nicht kollidieren — da das Vanilla-Layout
eng gepackt ist, würde ein falscher Offset sofort auffliegen. Gemalt wird
pro Face: gesprenkeltes Pink (deterministisches Hash-Mottling), dunklere
Kanten, Risse; dazu rote Augen, Ranke und Blüte im Golem-Stil. Java und
Bedrock nutzen dasselbe Layout, nur der Pfad im Pack unterscheidet sich
(`assets/minecraft/textures/entity/iron_golem/iron_golem.png` vs.
`textures/entity/iron_golem.png`).

## Verifikation (durchgeführt)

- UV-Asserts im Generator (Grenzen + paarweise Kollisionsfreiheit) — ok
- PNG-Signatur + 128×128 — ok
- `python3 -m zipfile -t` auf beiden Packs, `unzip -l`-Struktur, JSON via
  `json.tool` — ok
- Visuelle Prüfung der 8×-Vorschauen (`texture_preview.png`,
  `golem_preview.png` = zusammengesetzte Frontansicht) — ok

## Nächste Schritte (offen)

- In-Game-Test (Bedrock mobil und/oder Java) + Screenshot → dann GRÜN ohne
  Vorbehalt
- Crackiness-Overlays (`iron_golem_crackiness_*.png`, Java) pink einfärben,
  falls beschädigte Golems grau durchschimmern
- Teil 2 des Spikes (geparkt): Fontane-Handschrift als Minecraft-Font
  exportieren — Plan liegt vor, Reuse von `buildInstanceFont`
  (`src/lib/vfExport.ts`)
