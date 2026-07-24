# VF-Spike: Variable Fonts aus dem Fontane-Skelett (2026-07-24)

Ergebnis von Council-Runde 2, Stufe 0b — **der Spike ist GRÜN**: Aus einem
gezeichneten Skelett entsteht ein echtes 3-Achsen-Variable-Font, der
Union-Blocker ist per Resampling umgangen.

## Die drei Achsen

| Achse | Bereich | Wie |
|---|---|---|
| `wght` Strichbreite | 100–400–900 | echte perfect-freehand-Re-Renders derselben Centerline (size × 0.45 / 1.0 / 1.9) |
| `wdth` Buchstabenbreite | 70–100–135 | affine x-Skalierung des Default-Masters (Advance skaliert mit) |
| `slnt` Neigung | −12–0–12 | Scherung um die Baseline (+12 = lehnt rechts) |

## Warum es funktioniert (der Trick gegen den Union-Blocker)

`compileDocument()` unioniert Stroke-Outlines — das zerstört die
Punktkorrespondenz zwischen Masters (gvar braucht identische Punktstruktur).
Der Spike umgeht das doppelt:

1. **Keine Union.** Jeder Stroke bleibt eine eigene Kontur; überlappende
   Konturen sind in TrueType erlaubt (`OVERLAP_SIMPLE`-Flag wird gesetzt).
2. **Resampling.** Jede Kontur wird auf exakt 96 arc-length-äquidistante
   Punkte resampled — Korrespondenz ist damit *konstruktiv* garantiert,
   unabhängig von perfect-freehand-Interna. (Kosten: Q-Kurven werden zu
   96-Punkt-Polygonen — für Produktion später Kurven-Fitting ergänzen.)

Nur `wght` braucht echte Re-Renders; `wdth`/`slnt` werden in `build_vf.py`
affin vom Default-Master abgeleitet (per Konstruktion korrespondenz-sicher).
Wichtig: Die Kalibrierung (guide/bbox-Transform aus `build_ttf.py`) wird
**nur vom Default-Master** berechnet und identisch auf thin/bold angewendet —
sonst würde die Normalisierung genau den Gewichtsunterschied wegskalieren.

## Pipeline

```
node make-vf-fixture.mjs          # synthetische Test-FFF (l + o) → fixtures/spike-lo.fff
node gen-vf-masters.mjs [in.fff]  # FFF → vf-masters.json (default/thin/bold, 96 pt/Ring, keine Union)
python3 build_vf.py               # → fontane-vf.ttf (fvar 3 Achsen + gvar, 6 Tuples/Glyph)
```

Mit einer **echten** Zeichnung: FFF im Studio exportieren („Download FFF"),
dann `node gen-vf-masters.mjs pfad/zu/deinem.fff && python3 build_vf.py`.

**Verifiziert** (fixture, fontTools instancer): alle 6 Extreme interpolieren —
bold verbreitert den Strich beidseitig, wide skaliert ×1,35, slant schert um
die Baseline. `vf-preview.html` (im Browser über einen lokalen Server öffnen)
hat drei Slider auf dem generierten TTF.

## /vf — das versteckte Lab in der App

`src/app/vf/` (nicht verlinkt, `robots: noindex` — gleiche Mechanik wie
`/anneliese`): rendert die eigenen getaggten Glyphen als Text mit den drei
Achsen als Live-Slidern (wght = echtes Re-Rendering pro Frame, wdth/slnt =
Canvas-Transform, identische Semantik wie im TTF) plus **„Atmen"**-Toggle
(wght oszilliert per rAF — Vorgeschmack auf die
VF-+-CSS-`font-variation-settings`-Keyframes-Endform aus dem Council).
Liest die Studio-Daten read-only aus localStorage; leerer Zustand zeigt
einen Hinweis. Hinweis Preview-Testing: rAF pausiert in versteckten Tabs
(dokumentierte Einschränkung, siehe Projekt-History) — Animation nur bei
sichtbarem Tab beurteilen.

## Nächste Schritte (offen)

- Kurven-Fitting statt 96-Punkt-Polygone (Dateigröße/Qualität)
- Achsen-Ideen aus der Diskussion: `BLOT` (bloat/unbloat = size-Offset),
  `RND` (round-to-corner = smoothing-Parameter) — beide parametrisch, laufen
  durch dieselbe Pipeline; „Augen-links/rechts"-Achse = zwei gezeichnete
  Zustände + Ring-Matching + Resampling (drawn-master-Paare, später)
- `wght`-Advance bleibt konstant (bearing-basiert) — bewusst; bei
  bbox-Fallback-Glyphen kann Bold leicht überhängen
- Serverless-Endpoint erst, wenn das Lab beweist, dass es Spaß macht
