import type { Metadata } from "next";
import PageviewTracker from "../PageviewTracker";
import LanguageSwitcher from "../LanguageSwitcher";
import { hreflangPaths } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Imprint & Privacy — Fontane.Studio",
  alternates: {
    canonical: "/legal",
    languages: hreflangPaths("legal"),
  },
};

export default function LegalPage() {
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }}>
          <h1 style={{ fontSize: 28 }}>Imprint &amp; Privacy</h1>
          <LanguageSwitcher slug="legal" current="en" />
        </div>

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Imprint</h2>
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

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Privacy</h2>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>What we don&apos;t do</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          No cookies. No third-party trackers, ads, or analytics scripts — no Google Analytics, no Meta Pixel,
          nothing like that. Nothing at all is written to your device for tracking purposes: no cookie, no
          local storage, no identifier of any kind that survives closing the tab. Because of that, we also
          can&apos;t tell whether you have been here before.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Mini analytics</h3>
        <p style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.7 }}>
          Visiting the live site (fontane.studio) briefly logs the events below. Every one of them is either a
          count or a fixed category from a short list — never free text, never a file, never anything you drew:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Page visits</strong> — counted via a one-way hash of your IP address, your browser&apos;s
            user-agent, and the calendar date, combined with a private salt. That hash changes every day and
            can&apos;t be reversed back into your IP — it only lets us approximate how many different people
            visit per day, without storing your actual IP anywhere. We also record the referring site&apos;s
            hostname only (e.g. &quot;google.com&quot;), never a full URL or query parameters, plus which page
            you landed on (e.g. &quot;editor&quot;, &quot;marketplace&quot;), your country as a two-letter code,
            your browser language as a two-letter code, and whether the device is a phone, tablet or desktop.
            The country comes from our host&apos;s edge network and the device category is read from the
            user-agent string — neither the IP nor the full user-agent is stored.
          </li>
          <li>
            <strong>A visit id</strong> — a random number generated fresh on every page load and kept only in
            the page&apos;s memory. It is <em>not</em> stored on your device, so reloading, opening a second tab,
            or coming back tomorrow all produce a completely unrelated id, and there is no way to connect them.
            It exists so the events in one visit can be counted together — for example &quot;how many visits used
            a drawing tool at least once&quot; — rather than as unconnected totals.
          </li>
          <li>
            <strong>Time on site</strong> — how many seconds a visit was actually visible, and in which part of
            the app (Grid, Free Draw, Editor, Animate).
          </li>
          <li>
            <strong>Tool actions</strong> — that a tool was used and which one (e.g. &quot;pen&quot;,
            &quot;eraser&quot;), in which part of the app, and whether the input was a stylus, a finger or a
            mouse. Not what you drew with it, where on the canvas, or on which letter.
          </li>
          <li>
            <strong>Undo</strong> — that an undo happened, and which tool had been used last.
          </li>
          <li>
            <strong>Font exports</strong> — which file format you exported (e.g. &quot;otf&quot;) and roughly how
            many letters the document had, as one of five ranges (empty, 1–5, 6–20, 21–60, more than 60). The
            exact number is never recorded, and neither is the font itself.
          </li>
          <li>
            <strong>Character sets</strong> — which of the built-in character sets (e.g. &quot;Latin
            Extended&quot;) you switched on or off in the Grid.
          </li>
          <li>
            <strong>Blocked actions and errors</strong> — that an entry code was rejected, or that something like
            an export failed, with a short label saying where. Never the code you typed, and never the contents
            of an error.
          </li>
          <li>
            <strong>Guided tour</strong> — that the first-time tour started, that it was completed, or the step
            number (1–8) it was skipped at. Never anything about what you drew.
          </li>
        </ul>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Your language is taken from the <code>Accept-Language</code> header your browser sends with the request
          anyway, and your country from our host&apos;s edge network — we don&apos;t ask your device for either.
          None of this fires from local development or preview deployments, only the real production site. It is
          processed under legitimate interest (GDPR Art. 6(1)(f)): understanding rough usage without identifying
          anyone.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Opting out</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Three ways, all of which work without you telling us anything:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            If your browser or extension sends <strong>Global Privacy Control</strong> (or the older Do Not
            Track), we drop the request before anything is read, derived or written. Nothing needs configuring
            here.
          </li>
          <li>
            Add <code>?notrack</code> to the URL (e.g. <code>fontane.studio/?notrack</code>) and nothing is even
            sent for that page load. Because we store nothing on your device, this has to be part of the address
            each time — bookmark it and it happens by itself.
          </li>
          <li>Block requests to <code>/api/track</code>. Nothing else on the site depends on them.</li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>How long we keep it, and your rights</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          The daily visitor hash is erased after <strong>90 days</strong>. The remaining event rows — counts and
          category labels — are deleted after <strong>14 months</strong>.
        </p>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          You have the right to access, rectification, erasure, restriction, portability, and to object
          (GDPR Art. 15–21). We have to be straight with you about one of them: for the analytics data we
          genuinely cannot identify you, and we won&apos;t ask you for extra information in order to be able to
          — so we can&apos;t look up &quot;your&quot; rows to show or delete them, and Art. 11(2) is exactly the
          case this describes. Objecting is the right that does work in practice, and any of the three methods
          above exercises it immediately. For anything concerning a font you published to the Marketplace,
          write to us and we can act on it. You can also complain to a supervisory authority — for us that is
          the Berlin Commissioner for Data Protection and Freedom of Information.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Your drawings and fonts</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Everything you draw and tag — strokes, glyphs, metrics, settings — is saved only in your own
          browser&apos;s local storage. We never see it, and it&apos;s never sent to our servers unless you
          explicitly choose to:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Export</strong> a font, JSON, skeleton SVG, or FFF project file — generated entirely in your
            browser and offered to you as a download; nothing is uploaded.
          </li>
          <li>
            <strong>Publish</strong> a font to the Marketplace — this uploads the compiled font file plus the
            name you chose to our storage, along with a small metadata record (font name, glyph count, publish
            date, download count). Once published, it&apos;s public — anyone with the link, or browsing the
            Marketplace, can view and download it. There&apos;s no account system, so a published font
            currently can&apos;t be edited, renamed, or taken down by request through the app — double-check
            what you&apos;re publishing beforehand.
          </li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Infrastructure</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          The site is hosted on Vercel (application and edge network), with Supabase as our database and file
          storage provider for published fonts and the anonymous analytics described above. We don&apos;t run
          any servers of our own.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>About this page</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          This describes what the site actually, technically does today, kept in sync as that changes — not a
          substitute for formal legal advice. If you need a legally certified policy for your own use case,
          have it reviewed by a lawyer.
        </p>
      </div>
    </div>
    </>
  );
}
