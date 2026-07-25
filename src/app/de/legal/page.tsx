import type { Metadata } from "next";
import Link from "next/link";
import PageviewTracker from "../../PageviewTracker";
import LanguageSwitcher from "../../LanguageSwitcher";
import { hreflangPaths, localizedPath } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Impressum & Datenschutz — Fontane.Studio",
  alternates: {
    canonical: localizedPath("legal", "de"),
    languages: hreflangPaths("legal"),
  },
};

export default function LegalPageDE() {
  return (
    <>
      <PageviewTracker page="legal" />
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
      <div style={{ maxWidth: 720, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Impressum &amp; Datenschutz</h1>
          <LanguageSwitcher slug="legal" current="de" />
        </div>
        <p style={{ marginBottom: 32, fontSize: 13, lineHeight: 1.6, opacity: 0.7, fontStyle: "italic" }}>
          Vorläufige Übersetzung, noch nicht rechtlich geprüft. Im Zweifel oder bei Abweichungen gilt die{" "}
          <Link href="/legal" style={{ color: "#1f1934" }}>
            englische Originalfassung
          </Link>
          .
        </p>

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Impressum</h2>
        <p style={{ marginBottom: 40, fontSize: 14, lineHeight: 1.7 }}>
          Aisu.Studio
          <br />
          Dominik Heilig
          <br />
          c/o Working
          <br />
          Manteuffelstraße 58
          <br />
          10999 Berlin
        </p>

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Datenschutz</h2>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Was wir nicht tun</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Keine Cookies. Keine Trackingskripte, Werbe- oder Analyse-Tools von Drittanbietern — kein Google
          Analytics, kein Meta Pixel, nichts dergleichen. Es wird nichts zu Tracking-Zwecken auf deinem Gerät
          gespeichert: kein Cookie, kein Local Storage, keinerlei Kennung, die das Schließen des Tabs überdauert.
          Deshalb können wir auch nicht erkennen, ob du schon einmal hier warst.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Mini-Analytics</h3>
        <p style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.7 }}>
          Der Besuch der Live-Seite (fontane.studio) protokolliert kurz die folgenden Ereignisse. Jedes davon ist
          entweder ein Zähler oder eine feste Kategorie aus einer kurzen Liste — nie Freitext, nie eine Datei, nie
          etwas, das du gezeichnet hast:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Seitenbesuche</strong> — gezählt über einen Einweg-Hash deiner IP-Adresse, des User-Agents
            deines Browsers und des Kalenderdatums, kombiniert mit einem privaten Salt. Dieser Hash ändert sich
            täglich und lässt sich nicht auf deine IP zurückrechnen — er erlaubt uns nur eine Näherung, wie viele
            verschiedene Personen pro Tag vorbeischauen, ohne deine tatsächliche IP irgendwo zu speichern. Wir
            erfassen außerdem nur den Hostnamen der verweisenden Seite (z.&nbsp;B. &quot;google.com&quot;), nie
            eine vollständige URL oder Query-Parameter, dazu welche Seite du erreicht hast (z.&nbsp;B.
            &quot;editor&quot;, &quot;marketplace&quot;), dein Land als Zwei-Buchstaben-Code, deine
            Browsersprache als Zwei-Buchstaben-Code, und ob es sich um ein Smartphone, Tablet oder
            Desktop-Gerät handelt. Das Land kommt vom Edge-Netzwerk unseres Hosters, die Gerätekategorie wird aus
            dem User-Agent-String gelesen — weder die IP noch der vollständige User-Agent werden gespeichert.
          </li>
          <li>
            <strong>Eine Besuchs-ID</strong> — eine Zufallszahl, frisch bei jedem Seitenaufruf erzeugt und nur im
            Arbeitsspeicher der Seite gehalten. Sie wird <em>nicht</em> auf deinem Gerät gespeichert, sodass ein
            Reload, ein zweiter Tab oder ein Besuch morgen jeweils eine völlig unabhängige ID erzeugen — es gibt
            keine Möglichkeit, sie zu verknüpfen. Sie existiert, damit die Ereignisse eines Besuchs gemeinsam
            gezählt werden können — zum Beispiel &quot;wie viele Besuche haben mindestens einmal ein
            Zeichenwerkzeug benutzt&quot; — statt als unverbundene Gesamtsummen.
          </li>
          <li>
            <strong>Verweildauer</strong> — wie viele Sekunden ein Besuch tatsächlich sichtbar war, und in
            welchem Teil der App (Grid, Free Draw, Editor, Animate).
          </li>
          <li>
            <strong>Werkzeug-Aktionen</strong> — dass ein Werkzeug benutzt wurde und welches (z.&nbsp;B.
            &quot;pen&quot;, &quot;eraser&quot;), in welchem Teil der App, und ob die Eingabe per Stift, Finger
            oder Maus erfolgte. Nicht, was du damit gezeichnet hast, wo auf der Zeichenfläche, oder bei welchem
            Buchstaben.
          </li>
          <li>
            <strong>Rückgängig</strong> — dass ein Rückgängig-Vorgang stattfand, und welches Werkzeug zuletzt
            benutzt wurde.
          </li>
          <li>
            <strong>Font-Exporte</strong> — welches Dateiformat du exportiert hast (z.&nbsp;B. &quot;otf&quot;)
            und ungefähr wie viele Buchstaben das Dokument enthielt, als eine von fünf Bandbreiten (leer, 1–5,
            6–20, 21–60, mehr als 60). Die genaue Zahl wird nie erfasst, ebenso wenig der Font selbst.
          </li>
          <li>
            <strong>Zeichensätze</strong> — welche der eingebauten Zeichensätze (z.&nbsp;B. &quot;Latin
            Extended&quot;) du im Grid ein- oder ausgeschaltet hast.
          </li>
          <li>
            <strong>Blockierte Aktionen und Fehler</strong> — dass ein Zugangscode abgelehnt wurde, oder dass
            etwas wie ein Export fehlgeschlagen ist, mit einem kurzen Label zum Ort. Nie der eingegebene Code,
            und nie der Inhalt eines Fehlers.
          </li>
        </ul>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Deine Sprache wird aus dem <code>Accept-Language</code>-Header entnommen, den dein Browser ohnehin mit
          der Anfrage sendet, dein Land vom Edge-Netzwerk unseres Hosters — wir fragen dein Gerät nach keinem von
          beidem. Nichts davon läuft in der lokalen Entwicklung oder auf Preview-Deployments, nur auf der echten
          Produktivseite. Die Verarbeitung erfolgt auf Basis berechtigten Interesses (DSGVO Art. 6 Abs. 1 lit.
          f): grobes Nutzungsverständnis, ohne irgendjemanden zu identifizieren.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Opt-out</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Drei Wege, die alle funktionieren, ohne dass du uns irgendetwas mitteilst:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            Wenn dein Browser oder eine Erweiterung <strong>Global Privacy Control</strong> (oder das ältere Do
            Not Track) sendet, verwerfen wir die Anfrage, bevor irgendetwas gelesen, abgeleitet oder geschrieben
            wird. Hier muss nichts konfiguriert werden.
          </li>
          <li>
            Füge <code>?notrack</code> an die URL an (z.&nbsp;B. <code>fontane.studio/?notrack</code>), dann wird
            für diesen Seitenaufruf gar nichts erst gesendet. Da wir nichts auf deinem Gerät speichern, muss das
            jedes Mal Teil der Adresse sein — als Lesezeichen speichern, dann geschieht es von selbst.
          </li>
          <li>Blockiere Anfragen an <code>/api/track</code>. Nichts anderes auf der Seite hängt davon ab.</li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Wie lange wir es aufbewahren, und deine Rechte</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Der tägliche Besucher-Hash wird nach <strong>90 Tagen</strong> gelöscht. Die verbleibenden
          Ereigniszeilen — Zähler und Kategorie-Labels — werden nach <strong>14 Monaten</strong> gelöscht.
        </p>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und
          Widerspruch (DSGVO Art. 15–21). Bei einem Punkt müssen wir ehrlich sein: Bei den Analytics-Daten können
          wir dich tatsächlich nicht identifizieren, und wir werden dich nicht um zusätzliche Angaben bitten, um
          das zu ermöglichen — wir können also nicht &quot;deine&quot; Zeilen heraussuchen, um sie anzuzeigen
          oder zu löschen, und genau diesen Fall beschreibt Art. 11 Abs. 2 DSGVO. Der Widerspruch ist das Recht,
          das in der Praxis tatsächlich wirkt, und jede der drei oben genannten Methoden übt ihn sofort aus. Für
          alles, was einen von dir im Marketplace veröffentlichten Font betrifft, schreib uns, und wir können
          handeln. Du kannst dich außerdem bei einer Aufsichtsbehörde beschweren — für uns ist das die Berliner
          Beauftragte für Datenschutz und Informationsfreiheit.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Deine Zeichnungen und Fonts</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Alles, was du zeichnest und taggst — Striche, Glyphen, Metriken, Einstellungen — wird ausschließlich im
          Local Storage deines eigenen Browsers gespeichert. Wir sehen es nie, und es wird nie an unsere Server
          gesendet, außer du entscheidest dich ausdrücklich dafür:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Export</strong> eines Fonts, JSON, Skeleton-SVG oder einer FFF-Projektdatei — komplett in
            deinem Browser erzeugt und dir als Download angeboten; nichts wird hochgeladen.
          </li>
          <li>
            <strong>Veröffentlichung</strong> eines Fonts im Marketplace — dabei werden die kompilierte
            Font-Datei plus der von dir gewählte Name in unseren Speicher hochgeladen, zusammen mit einem
            kleinen Metadaten-Eintrag (Font-Name, Glyphenanzahl, Veröffentlichungsdatum, Download-Zahl). Einmal
            veröffentlicht, ist es öffentlich — jeder mit dem Link, oder beim Durchstöbern des Marketplace, kann
            es ansehen und herunterladen. Es gibt kein Konto-System, daher kann ein veröffentlichter Font
            aktuell nicht über die App bearbeitet, umbenannt oder auf Anfrage entfernt werden — prüfe vorher
            genau, was du veröffentlichst.
          </li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Infrastruktur</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Die Seite wird bei Vercel gehostet (Anwendung und Edge-Netzwerk), mit Supabase als Datenbank- und
          Speicheranbieter für veröffentlichte Fonts und die oben beschriebenen anonymen Analytics. Wir betreiben
          keine eigenen Server.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Zu dieser Seite</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          Diese Seite beschreibt, was die Website heute tatsächlich, technisch tut, und wird bei Änderungen
          synchron gehalten — sie ersetzt keine Rechtsberatung. Wenn du eine rechtssicher geprüfte Policy für
          deinen eigenen Anwendungsfall brauchst, lass sie von einem Anwalt prüfen.
        </p>
      </div>
    </div>
    </>
  );
}
