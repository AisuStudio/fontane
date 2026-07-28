# Noveco — Handover-Briefing

Stand: Übergabe an eine auf `AisuStudio/Noveco` geschränkte Session (bzw. Mitwirkende).
Dieses Dokument macht die Fortführung ohne Rückfragen möglich.

---

## 1. Was Noveco ist

> Ein offenes, **mobile-first** Daten-Werkzeug, das eine Waldbrandfläche danach lesbar macht,
> welche Wiederbewaldung dort zugleich **klimaangepasst, wirtschaftlich zukunftsfähig und
> kohlenstoff-wirksam** ist — und diesen Wert trackbar macht (Anschluss GHG-Protocol-LSR, Scope 1–3).

Leitsatz: **Der Wert einer Sukzession ist keine Eigenschaft der Pflanze, sondern der Fläche.**
Ankerfläche: **Jüterbog** (Brandenburg); eigene Bodenwahrheit: Garten + Feriengrundstücke (Bestensee).
Persönliches Ziel des Autors: sich als **Cross-Discipline Product Manager** mit Wertekanon und
Netzwerk zeigen — das Konzept demonstriert das durch seine Struktur, nicht durch Behauptung.

## 2. Aktueller Stand (gebaut)

Mobile-first, abhängigkeitsfrei (statisches HTML/CSS/JS, kein Build). Öffnen: `index.html`.

- `index.html` — App-Shell, Bottom-Tab-Navigation (4 Tabs)
- `app.css` — **waffle Token-Schicht** + Komponenten (mobile-first)
- `app.js` — View-Wechsel, Scorecard-/Maßnahmen-Daten, Komposit-Renderer (Canvas)
- `README.md`, `BRIEFING.md` (dieses Dokument)

Vier Ansichten: **Komposit** (Erholungsbild) · **Scorecard** (Novel vs. Novel) ·
**Maßnahmen** (nach Akteur: Einzelperson/Kommune/Forstbetrieb) · **Konzept**.

Zwei lokale Commits vorhanden (`Noveco MVP scaffold …`, `Add Maßnahmen view …`).

Private Vorschau-Artefakte (nur im Konto des Autors sichtbar):
- Noveco-Preview: https://claude.ai/code/artifact/3e39b977-473b-45bf-b166-cc00e3d364fa
- Konzept-One-Pager „Zweierlei Neuland": https://claude.ai/code/artifact/0b627136-7550-46ab-84dc-ddb97cfde60a

## 3. Push abschließen (aktueller Blocker)

Gebaut wurde in einer Session, die nur auf `fontane` autorisiert war → Push nach Noveco dort **403**.
In **dieser** (Noveco-)Session so abschließen:

1. Die vier App-Dateien einspielen (aus `Noveco.tar.gz` **nur** `index.html`, `app.css`, `app.js`,
   `README.md` übernehmen — **nicht** den mitgepackten `.git`-Ordner; das Remote dieser Session nutzen).
2. Committen und pushen:
   ```bash
   git add -A
   git commit -m "Noveco MVP: mobile-first app, waffle token layer, Maßnahmen-Tab"
   git push
   ```

## 4. Design-Sprache: waffle

Alle Tokens liegen **gekapselt** in `app.css` im Block `WAFFLE TOKEN LAYER` (CSS Custom Properties:
Farbe, Space, Radius, Elevation, Type). Aktuell **Platzhalterwerte**, die die Konzept-Palette spiegeln.

**TODO Reskin:** Werte 1:1 durch waffle-Output ersetzen. Komponenten referenzieren ausschließlich
diese Properties — es muss **kein** Komponenten-Code angefasst werden.

## 5. Offene nächste Bau-Schritte

**(A) waffle-Reskin** — echte Tokens in die Token-Schicht (siehe §4).

**(B) Sentinel-2 anbinden** — das Erholungs-Komposit ist derzeit ein **prozeduraler Platzhalter**
(`renderComposite()` in `app.js`). Ersetzen durch echte Daten:
- Quelle: **Copernicus Data Space Ecosystem** → **Sentinel Hub Process API** (Free-Tier, OAuth-Client-Credentials).
- Index **NBR** = (B08 − B12) / (B08 + B12); Produkt **L2A**; Wolken < 10 %; Sommer (Jul/Aug).
- Drei Jahre → Kanäle R/G/B; AOI = Bounding Box um die Brandfläche Jüterbog (Feuerjahr 2019).
- Umsetzung: pro Jahr eine NBR-Kachel holen, in Canvas laden, zu RGB mergen — Logik wie im Platzhalter.
- **Secret-Handling:** Static-App → entweder Kacheln vorab als PNG ablegen **oder** eine kleine
  Serverless-Funktion als Proxy (Client-Secret nie ins Frontend).

**(C) Verstärkungs-Ebene / schwächste Datenpunkte** (über Kontakte klären):
- Neophyten-Feinkartierung (frei nicht verfügbar).
- Eddy-Covariance-Flüsse für MRV-taugliche Funktion/Kohlenstoff → **Prof. Oliver Sonnentag (UdeM)**;
  Fernerkundung/Vegetation → **AWI Potsdam**.

## 6. Konzept-Kontext (Kurzfassung)

- **Novel vs. Novel:** Kulturkiefernforst (gepflanzt, brandgefährdet) vs. Neophyten-Sukzession —
  zwei menschgemachte Ökosysteme; bewertet wird **Funktion, nicht Herkunft**.
- **Kern + Verstärkung:** Kern aus offenen Daten (Sentinel-2 + Bodenwahrheit + GALK) steht allein;
  Flüsse sind Rigor-/MRV-Verstärker, keine Abhängigkeit. „Bewertet, entscheidet nicht."
- **Kohlenstoff/LSR:** GHG-Protocol Land Sector & Removals Standard (Jan 2026, wirksam 2027) erlaubt
  Land-CO₂-Entnahmen in Scope 1/3 — verlangt standort-spezifische Daten + Permanenz-Monitoring.
  Reversal-Beleg: Treuenbrietzen ist 2022 erneut gebrannt.
- **Maßnahmen = Ammenstrukturen:** Struktur schafft Mikroklima (Wind bremsen, Schatten, Tau, Streu);
  von Gobi-Stroh-Schachbrettern bis Leitplanke; reburn-resilient, weil Stein/Totholz nicht brennen.
- **Wertekanon:** vorurteilsfrei · Kontext vor Dogma · ehrlich über Grenzen · bewerten, nicht entscheiden.

## 7. Netzwerk & Quellen

- **TreesAI / Dark Matter Labs** („Nature as Infrastructure"; kennt die GALK-Liste).
- **UdeM / Prof. Oliver Sonnentag** (Flüsse), **AWI Potsdam**, **LFE Eberswalde / PYROPHOB**.
- Referenzen: PYROPHOB · Copernicus/Sentinel-2 · GHG Protocol LSR (2026) · GALK-Straßenbaumliste ·
  Stroh-Schachbrett/Nurse-Structures (Shapotou; New Phytologist 2025) · Hobbs, „Novel Ecosystems".

---

## Anhang A — Sentinel-2-Rezept: Erholungs-Komposit Jüterbog

Ersetzt das prozedurale Platzhalter-Komposit (`renderComposite()` in `app.js`).

### AOI (Bounding Box, EPSG:4326, ca. — im Copernicus Browser an der Brandnarbe feinjustieren)
Ehem. Truppenübungsplatz / NSG Forst Zinna–Jüterbog–Keilberg, Brand 2019 (744 ha, westl. der Stadt):

    lonMin 12.90, latMin 51.98, lonMax 13.06, latMax 52.08

Feuerjahr 2019 → Jahre z. B. R=2020, G=2022, B=2024 (Sommer Jul/Aug, Wolken < 10 %).

### Daten & Auth (Copernicus Data Space Ecosystem, kostenlos)
- Registrieren → OAuth-Client (client_id / client_secret).
- Token: `POST https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token`
  (`grant_type=client_credentials`)
- Process API: `POST https://sh.dataspace.copernicus.eu/api/v1/process`

### Evalscript (NBR, ein Band, pro Jahr)

    //VERSION=3
    function setup() {
      return { input: ["B08","B12","dataMask"], output: { bands: 1, sampleType: "UINT8" } };
    }
    function evaluatePixel(s) {
      if (s.dataMask === 0) return [0];
      let nbr = (s.B08 - s.B12) / (s.B08 + s.B12);        // ~ -1..1
      return [Math.max(0, Math.min(255, Math.round((nbr + 1) / 2 * 255)))];
    }

### Request-Body (pro Jahr; L2A, Sommerfenster, Wolkenfilter, wolkenärmste Szene)

    {
      "input": {
        "bounds": { "bbox": [12.90,51.98,13.06,52.08],
                    "properties": { "crs": "http://www.opengis.net/def/crs/EPSG/0/4326" } },
        "data": [{ "type": "sentinel-2-l2a",
                   "dataFilter": { "timeRange": { "from": "2022-07-01T00:00:00Z", "to": "2022-08-31T23:59:59Z" },
                                   "maxCloudCoverage": 10 },
                   "mosaickingOrder": "leastCC" }]
      },
      "output": { "width": 512, "height": 512,
                  "responses": [{ "identifier": "default", "format": { "type": "image/png" } }] },
      "evalscript": "<Evalscript oben, als String>"
    }

### Merge zu RGB (Client — ersetzt die Platzhalter-Logik in renderComposite)
- 3 Requests (Jahr R / G / B) → 3 PNGs → je in ein Offscreen-Canvas, `getImageData`.
- Ziel-Pixel: R = NBR[JahrR], G = NBR[JahrG], B = NBR[JahrB]. Struktur wie im Platzhalter, nur echte Werte.

### Secret-Handling (WICHTIG — Static App)
`client_secret` NIE ins Frontend. Zwei saubere Wege:
1. **Vorab-Kacheln:** die 3 PNGs per Skript holen, als statische Dateien in `assets/` legen — App bleibt rein statisch.
2. **Mini-Proxy:** kleine Serverless-Funktion (Cloudflare/Vercel) hält das Secret und liefert die 3 Bilder.
