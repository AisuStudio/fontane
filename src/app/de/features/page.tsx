import type { Metadata } from "next";
import MarketplaceNav from "../../marketplace/MarketplaceNav";
import PageviewTracker from "../../PageviewTracker";
import LanguageSwitcher from "../../LanguageSwitcher";
import { hreflangPaths, localizedPath } from "@/lib/i18n";

const description =
  "Alle Funktionen von Fontane.Studio: druckempfindliche Handschrift-Erfassung, ein Illustrator-Bezierstift mit weichen Ankerpunkten und gehaltenen Tastenkürzeln, Grid- und Free-Zeichnen, Ligaturen und Alternates, Kopieren/Einfügen über Ansichten hinweg, und sofortiger OTF-Export — alles im Browser, kostenlos.";

export const metadata: Metadata = {
  title: "Funktionen — Fontane.Studio",
  description,
  alternates: {
    canonical: localizedPath("features", "de"),
    languages: hreflangPaths("features"),
  },
  openGraph: {
    title: "Funktionen — Fontane.Studio",
    description,
    url: "https://fontane.studio/de/features",
    siteName: "Fontane.Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Funktionen — Fontane.Studio",
    description,
  },
};

// Mirrors features/page.tsx's jsonLd, in German — same reasoning: this is
// the page AI answer engines should land on for a German-language "was kann
// Fontane.Studio" query, so every real feature gets its own atomic sentence.
// Keep this list's items 1:1 with the English featureList when either one
// changes — a drift here is a silent SEO/GEO regression, not just a typo.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Fontane.Studio",
  url: "https://fontane.studio/de",
  applicationCategory: "DesignApplication",
  operatingSystem: "Any (runs in the browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Druckempfindliches Freihandzeichnen mit Apple Pencil, Wacom oder Maus",
    "Kalligrafie-Werkzeug: eine Breitfeder mit fester Größe/Ovalität/Winkel, Strichbreite aus der Zugrichtung statt aus dem Druck",
    "Grid-Ansicht mit Führungslinien pro Zeichen (Oberlänge, x-Höhe, Grundlinie, Unterlänge) und verstellbaren Seitenabständen, mit einem Lock-Bearings-Schalter, der verhindert, dass Zeichnen über einem Abstand ihn verschiebt",
    "Illustrator-artige Vektorstift-Familie: Stift, Anker hinzufügen, Anker löschen und Anker umwandeln auf vertrauten Kürzeln (P, +, -, C)",
    "Weiche Ankerpunkte mit tangentenstetigen Griffen — das Ziehen eines Griffs hält den gegenüberliegenden auf gleicher Länge ausgerichtet, Alt bricht das Paar, Doppelklick schaltet zwischen weich/eckig um",
    "Gehaltene Tasten wie bei einem Desktop-Stiftwerkzeug: Cmd für kurzzeitige Direktauswahl, Shift für 45-Grad-Beschränkung, Leertaste zum Verschieben, Esc/Enter beendet einen Pfad — mit kontextbezogenen Stift-Cursorn für Hinzufügen, Schließen und Fortsetzen",
    "Der Vektorstift funktioniert auch innerhalb von Grid-Zellen, Formen werden automatisch dem Zeichen der Zelle zugeordnet",
    "Buchstaben-Punzen auf zwei Arten: eine Vektorform innerhalb einer anderen wird zur Punze (ein 'B' oder 'O' rein vektoriell zeichnen), und geschlossene Formen stanzen Löcher durch überlappende Striche",
    "Anker- und Nudge-Werkzeuge, um bereits gezeichnete Striche Punkt für Punkt umzuformen",
    "Kompakter, kontextbezogener Arbeitsbereich: Illustrator-artige Werkzeuggruppen-Flyouts und eine Glyphs-artige Einstellungs-Palette, die nur zeigt, was das aktive Werkzeug nutzt",
    "Zeichensatz-Bibliothek: Latin Basic, mittel- und westeuropäische Akzente, Kyrillisch, Griechisch, Interpunktion sowie Währungs- und Mathe-Symbole",
    "Ligaturen exportieren mit einer echten, automatischen OpenType-liga-Regel — die Ligatur löst von selbst aus, in Apps, die das Feature respektieren",
    "Stilistische Alternates exportieren als eigene benannte Glyphen zur manuellen Auswahl in einer Glyphen-Palette",
    "Striche und Vektorformen kopieren und einfügen innerhalb von Free Draw, innerhalb von Grid, und zwischen beiden",
    "Verschieben-, Drehen- und Skalieren-Werkzeuge zum Umformen und Neupositionieren gezeichneter Buchstaben",
    "Illustrator-artige kurzzeitige Auswahl: Cmd (oder Ctrl) halten, während Draw, Brush, Kalligrafie oder Radierer aktiv ist, um Striche per Lasso auszuwählen — loslassen, und du zeichnest mit demselben Werkzeug weiter",
    "Editor-Ansicht, um mit den eigenen getaggten Glyphen live Vorschautext zu tippen",
    "Animate-Modus: CSS-basierte Textanimationen, exportierbar als eigenständiges HTML-Embed",
    "Sofortiger OTF-Font-Export, komplett clientseitig erzeugt, kein Upload nötig",
    "Gewichtsfamilien-Export: Light, Regular und Bold als drei unabhängige OTF-Dateien mit gemeinsamem Familiennamen",
    "Skeleton-SVG-Export zur manuellen Weiterbearbeitung in Glyphs.app oder anderen Vektor-Werkzeugen",
    "FFF-Projektdateien, um einen Font zwischenzuspeichern und später fortzusetzen",
    "Glyphs.app-Importskript für die Feinarbeit auf Glyphenebene durch professionelle Schriftgestalter",
    "Marketplace zum Veröffentlichen, Durchstöbern und Herunterladen von Fonts anderer Nutzer",
    "Provenance-Prüfung, die vor der Veröffentlichung nachweist, dass ein Font tatsächlich von Hand gezeichnet wurde",
    "Keine Cookies, keine Drittanbieter-Tracker, DSGVO-sichere anonyme Analytics",
    "Installierbar als Progressive Web App, läuft komplett im Browser",
  ],
};

type Feature = { name: string; description: string };
type Section = { title: string; features: Feature[] };

const SECTIONS: Section[] = [
  {
    title: "Zeichnen & erfassen",
    features: [
      {
        name: "Free Draw",
        description:
          "Eine freie Leinwand zum Skizzieren von Buchstaben, genau wie auf Papier, mit echter druckempfindlicher Strichbreite von Apple Pencil, Wacom oder Maus.",
      },
      {
        name: "Grid-Ansicht",
        description:
          "Eine Zelle pro Zeichen, mit Ober-, x-Höhen-, Grund- und Unterlängen-Linien sowie verschiebbaren Seitenabständen — der systematische Weg, ein ganzes Alphabet zu zeichnen. Ein Lock-Bearings-Schalter fixiert die Abstände, damit Zeichnen darüber sie nicht versehentlich verschiebt.",
      },
      {
        name: "Mono-Linie & dynamische Striche",
        description: "Wechsle zwischen gleichbleibender Strichstärke und druckabhängiger Dicke, mit Live-Reglern für Größe/Ausdünnung/Glättung/Streamline.",
      },
      {
        name: "Austauschbare Pinsel",
        description:
          "Ein Skelett, viele Schriftbilder: Der gezeichnete Pfad bleibt die Quelle, und der darauf angewendete Pinsel — Druckverlauf, geschwungene Kalligrafiefeder oder Stipple-Stempel mit eigenem Abstand, Rotation und Streuung — lässt sich jederzeit austauschen und stylt jeden Buchstaben neu.",
      },
      {
        name: "Kalligrafie",
        description:
          "Eine eigene Breitfeder: ein Oval mit fester Größe, Rundung und Winkel, entlang deines Strichs gezogen — die Breite ergibt sich aus der Zugrichtung, nicht aus dem Druck, die klassische Breitfeder-Hand (Italic, Gotisch) statt druckbasiertem Kontrast.",
      },
    ],
  },
  {
    title: "Präzise Vektor-Werkzeuge",
    features: [
      {
        name: "Vektorstift-Familie",
        description:
          "Ein echter Bezierstift mit dem vollen Illustrator-Werkzeugkasten — Stift (P), Anker hinzufügen (+, fügt ein, ohne die Kurve zu verändern), Anker löschen (-), und Anker umwandeln (C) — nutzbar in Free Draw und direkt in Grid-Zellen, wo Formen automatisch dem Zeichen der Zelle zugeordnet werden.",
      },
      {
        name: "Weiche Anker & gehaltene Tasten",
        description:
          "Weiche Punkte halten ihre Griffe tangentenstetig; Alt bricht das Paar, Doppelklick schaltet zwischen weich/eckig um. Cmd halten für kurzzeitige Direktauswahl, Shift für 45°-Beschränkung, Leertaste zum Verschieben, Esc beendet einen Pfad — und der Stift-Cursor zeigt vorab, was ein Klick auslösen würde.",
      },
      {
        name: "Punzen",
        description:
          "Zeichne eine Form innerhalb einer anderen, und sie wird zur Punze — ein 'B' oder 'O' funktioniert rein vektoriell. Wo Striche im Spiel sind, stanzen geschlossene Formen stattdessen Löcher hinein, der klassische Weg, ein 'o' oder 'e' auszuschneiden.",
      },
      {
        name: "Anker & Nudge",
        description: "Forme einen bereits gezeichneten Freihandstrich um, indem du seine eigenen Ankerpunkte ziehst, einfügst oder löschst, ohne ihn neu zu zeichnen.",
      },
    ],
  },
  {
    title: "Dein Alphabet organisieren",
    features: [
      {
        name: "Zeichensätze",
        description:
          "Neue Fonts starten fokussiert auf Latin Basic (a–z, A–Z); mitteleuropäische Akzente, westeuropäische Zeichen, Kyrillisch, Griechisch, Zahlen, Interpunktion und Symbole lassen sich jederzeit dazuschalten — bereits gezeichnete Glyphen behalten immer ihre Zelle.",
      },
      {
        name: "Ligaturen & Alternates",
        description: "Markiere eine gezeichnete Form als Ligatur (z. B. 'fi'), und sie exportiert mit einer echten, automatischen OpenType-liga-Regel — die Ligatur löst von selbst aus, in Apps, die das Feature respektieren. Stilistische Alternates exportieren als eigene benannte Glyphen zur manuellen Auswahl in einer Glyphen-Palette.",
      },
      {
        name: "Eigene Glyphen",
        description: "Füge jedes beliebige einmalige Basiszeichen, Ligatur oder Alternate außerhalb der eingebauten Sätze über einen eigenen Namen hinzu.",
      },
    ],
  },
  {
    title: "Bearbeiten & anordnen",
    features: [
      {
        name: "Auswählen, Verschieben, Drehen, Skalieren",
        description:
          "Wähle per Lasso jede Kombination aus Strichen und Vektorformen aus und transformiere sie als Gruppe. Cmd/Ctrl halten, während Draw, Brush, Kalligrafie oder Radierer aktiv ist, aktiviert kurzzeitig die Auswahl, Illustrator-artig — loslassen, und du zeichnest weiter.",
      },
      {
        name: "Kopieren & Einfügen",
        description:
          "Dupliziere Striche und Formen innerhalb von Free Draw, innerhalb von Grid, oder zwischen beiden — in eine andere Grid-Zelle eingefügt, wird automatisch auf deren Größe angepasst.",
      },
      {
        name: "Rückgängig/Wiederholen",
        description: "Ein vollständiger Verlaufsstapel für Zeichnen, Taggen und Transformieren.",
      },
      {
        name: "Fokussierter Arbeitsbereich",
        description:
          "Verwandte Werkzeuge stapeln sich in Illustrator-artigen Flyout-Slots (langes Drücken zum Aufklappen), und die Einstellungs-Palette zeigt nur, was das aktive Werkzeug tatsächlich nutzt — Glyphs-artige einklappbare Abschnitte, mit einer Live-Pfad-Infobox während du am Stift arbeitest.",
      },
    ],
  },
  {
    title: "Setzen & Vorschau",
    features: [
      {
        name: "Editor-Ansicht",
        description: "Tippe frei mit deinen bereits getaggten Glyphen, um zu sehen, wie sich dein Font-in-Arbeit als echter Text liest.",
      },
      {
        name: "Animate",
        description: "Wende CSS-basierte Animationen (Pulsieren, Kippen, Glitch und mehr) auf dein Lettering an und exportiere es als eigenständiges HTML-Embed.",
      },
    ],
  },
  {
    title: "Überallhin exportieren",
    features: [
      {
        name: "OTF-Export",
        description: "Eine vollständige OpenType-Font-Datei, komplett im Browser erzeugt — nichts wird hochgeladen, nichts muss installiert werden.",
      },
      {
        name: "Gewichtsfamilien-Export",
        description: "Exportiere Light, Regular und Bold als drei unabhängige OTF-Dateien mit gemeinsamem Familiennamen — clientseitig aus denselben gezeichneten Strichen erzeugt, kein Server-Umweg.",
      },
      {
        name: "Skeleton-SVG-Export",
        description: "Die rohen Strich-Mittellinien als offener SVG-Pfad, bereit für die manuelle Weiterbearbeitung in Glyphs.app oder einem anderen Vektor-Werkzeug.",
      },
      {
        name: "FFF-Projektdateien",
        description: "Fontanes eigenes Speicherformat — jeder Strich, jede Glyphe, jede Einstellung, um einen Font später zu pausieren und fortzusetzen oder zwischen Geräten zu wechseln.",
      },
      {
        name: "Glyphs.app-Importskript",
        description: "Ein Python-Skript für Glyphs.app, das eine FFF-Datei direkt einliest und echte Glyphen mit korrekten Komponenten und Bezierknoten baut.",
      },
    ],
  },
  {
    title: "Deinen Font teilen",
    features: [
      {
        name: "Marketplace",
        description: "Veröffentliche einen fertigen Font, damit ihn jeder durchstöbern und herunterladen kann, oder teile einen direkten Link dazu.",
      },
      {
        name: "Provenance-Prüfung",
        description: "Bevor ein Font veröffentlicht werden kann, prüft Fontane auf eine plausible Historie echter Zeichenaktivität — ein leichtgewichtiger Schutz gegen konvertierte oder gestohlene Fonts.",
      },
    ],
  },
  {
    title: "Für Datenschutz gebaut",
    features: [
      {
        name: "Keine Tracker",
        description: "Keine Cookies, keine Drittanbieter-Analytics oder Werbeskripte, kein dauerhafter Identifier wird auf deinem Gerät gespeichert.",
      },
      {
        name: "Lokal zuerst",
        description: "Deine Zeichnungen leben ausschließlich im Speicher deines Browsers — nichts erreicht unsere Server, außer du exportierst oder veröffentlichst ausdrücklich.",
      },
    ],
  },
];

export default function FeaturesPageDE() {
  return (
    <>
      <PageviewTracker page="features" />
    <div
      style={{
        minHeight: "100vh",
        background: "#eae8e0",
        color: "#1f1934",
        fontFamily: "monospace",
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div style={{ maxWidth: 720, width: "100%" }}>
        <MarketplaceNav />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Funktionen</h1>
          <LanguageSwitcher slug="features" current="de" />
        </div>
        <p style={{ marginBottom: 40, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          Alles, was Fontane.Studio heute kann, komplett im Browser — von der ersten druckempfindlichen Skizze bis
          zum fertigen, exportierbaren Font.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} style={{ marginBottom: 40 }}>
            <h2
              style={{
                fontSize: 18,
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: "1px solid rgba(31,25,52,0.15)",
              }}
            >
              {section.title}
            </h2>
            {section.features.map((f) => (
              <div key={f.name} style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, marginBottom: 4 }}>{f.name}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.85 }}>{f.description}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
    </>
  );
}
