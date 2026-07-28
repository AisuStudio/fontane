# Noveco

Mobile-first Werkzeug-Konzept: **post-fire novel ecosystems** nach Funktion lesen, nicht nach Herkunft.

> Welche Wiederbewaldungs-Trajektorie nach einem Waldbrand ist zugleich **klimaangepasst,
> wirtschaftlich zukunftsfähig und kohlenstoff-wirksam** — und wie macht man das trackbar?

**Ankerfläche:** Jüterbog (Brandenburg). **Daten:** offenes Sentinel-2 + eigene Bodenwahrheit
+ GALK-Referenz; optional funktions-geerdet (Eddy-Covariance-Flüsse), CO₂-Anschluss (GHG-Protocol-LSR,
Scope 1–3).

## Stand

MVP-Gerüst, mobile-first, ohne Build-Schritt (statisches HTML/CSS/JS). Öffnen: `index.html`.

- Das **Erholungs-Zeitkomposit** ist aktuell ein prozeduraler **Platzhalter**, bis echte
  Sentinel-2-Kacheln angebunden sind.
- **Design-Sprache:** waffle. Alle Tokens liegen gekapselt in `app.css` (Block `WAFFLE TOKEN LAYER`)
  — Werte 1:1 durch waffle-Output ersetzbar, ohne die Komponenten anzufassen.

## Struktur

- `index.html` — App-Shell (Bottom-Tab-Navigation)
- `app.css` — Token-Schicht (waffle) + Komponenten, mobile-first
- `app.js` — View-Wechsel + Komposit-Renderer (Canvas)
