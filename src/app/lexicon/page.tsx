import type { Metadata } from "next";
import MarketplaceNav from "../marketplace/MarketplaceNav";
import PageviewTracker from "../PageviewTracker";

// Public since 2026-07-25 (council review) — English only: a small, genuinely
// useful glossary for people drawing their first font who've never had to
// know what a sidebearing is. Each term is written as an atomic, quotable
// definition on purpose — the same "answer engines should be able to lift
// this whole" reasoning as features/page.tsx's own jsonLd.
const description =
  "A small glossary of type-design terms — baseline, x-height, kerning vs. tracking, ligature, variable font, and more — written for someone drawing their first font, not someone who already owns a type-design textbook.";

export const metadata: Metadata = {
  title: "Type Lexicon — Fontane.Studio",
  description,
  alternates: { canonical: "/lexicon" },
  openGraph: {
    title: "Type Lexicon — Fontane.Studio",
    description,
    url: "https://fontane.studio/lexicon",
    siteName: "Fontane.Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Type Lexicon — Fontane.Studio",
    description,
  },
};

type Term = { term: string; definition: string };
type Section = { title: string; terms: Term[] };

const SECTIONS: Section[] = [
  {
    title: "The shape of a letter",
    terms: [
      {
        term: "Baseline",
        definition: "The invisible line every letter sits on — the flat bottom of an 'a', 'e', or 'x'. Descenders (the tail of a 'g' or 'y') hang below it.",
      },
      {
        term: "x-height",
        definition: "How tall lowercase letters are, measured from the baseline to the top of an 'x' — the single biggest factor in how big or small a typeface reads at the same point size.",
      },
      {
        term: "Cap height",
        definition: "How tall capital letters stand above the baseline. Usually close to, but not exactly, the height of an ascender.",
      },
      {
        term: "Ascender / Descender",
        definition: "The parts of a lowercase letter that reach above the x-height (the stem of a 'b', 'd', 'h', 'k', 'l') or below the baseline (the tail of a 'g', 'j', 'p', 'q', 'y').",
      },
      {
        term: "Counter",
        definition: "The enclosed or partially enclosed space inside a letter — the hole in an 'o', the two spaces in a 'B'. Draw it too small and the letter clogs up at small sizes.",
      },
      {
        term: "Bowl",
        definition: "The curved stroke that encloses a counter — the round part of a 'b', 'p', or 'o'.",
      },
      {
        term: "Terminal",
        definition: "Where a stroke ends without joining another stroke — the tip of a 'c' or the foot of an 'l'. Can be cut straight, angled, or rounded (a 'ball terminal').",
      },
      {
        term: "Stroke contrast",
        definition: "The difference between a letter's thickest and thinnest strokes. High contrast (thin hairlines, thick stems) reads as formal or calligraphic; low contrast (strokes all one width) reads as a monoline pen or a technical typeface.",
      },
      {
        term: "Serif / Sans-serif",
        definition: "Serif: the small finishing strokes at the ends of letters (like the feet on the letters in a newspaper headline). Sans-serif: no finishing strokes, just the bare stroke (like this website's own UI type).",
      },
    ],
  },
  {
    title: "Spacing and measurement",
    terms: [
      {
        term: "Em / Units per em (UPM)",
        definition: "The square a font's glyphs are designed inside — historically the width of a capital 'M'. Fontane, like most modern fonts, uses 1000 units per em: a coordinate system every glyph's outline is measured in, independent of the point size someone eventually sets the text at.",
      },
      {
        term: "Sidebearing",
        definition: "The empty space to the left and right of a glyph's ink, inside its own advance width — what actually keeps neighboring letters from touching. Fontane's Grid View lets you drag these directly as guide lines.",
      },
      {
        term: "Advance width",
        definition: "How far the cursor moves after typing a glyph — its ink plus both sidebearings. Get it wrong and letters either collide or drift apart.",
      },
      {
        term: "Kerning",
        definition: "A manual spacing adjustment for one specific pair of letters — classically 'AV' or 'To', where the default spacing looks too loose because the letter shapes interlock. Applied pair by pair, not to the whole font.",
      },
      {
        term: "Tracking",
        definition: "A uniform spacing adjustment applied to a whole run of text at once (tightening a headline, loosening small caps) — set by whoever is using the font, not baked into it the way kerning is.",
      },
    ],
  },
  {
    title: "How a font is actually built",
    terms: [
      {
        term: "Glyph",
        definition: "One drawn shape in a font — not quite the same as a 'character'. The character 'a' might have several glyphs behind it: a base form, a bold alternate, a swash variant, each its own outline.",
      },
      {
        term: "Ligature",
        definition: "Two or more letters redrawn as a single joined glyph — classically 'fi' or 'fl', where the dot of the 'i' would otherwise collide with the hook of the 'f'.",
      },
      {
        term: "Stylistic alternate",
        definition: "A second (or third) drawn version of a letter, available as a substitute for the default — a different lowercase 'a', a swashy capital, a single-story 'g'. The letter still means the same thing; it just looks different when chosen.",
      },
      {
        term: "Contextual alternates (calt)",
        definition: "An automatic rule baked into a font that swaps in a different glyph depending on what's next to it — so the same letter doesn't look identically stamped every time it repeats. The mechanism itself lives in the font file, not in whatever app displays the text.",
      },
      {
        term: "OpenType feature",
        definition: "A named, switchable behavior built into a font file — ligatures, stylistic alternates, and contextual alternates are each their own feature, off by default in most apps unless the user (or the app) turns them on.",
      },
      {
        term: "Hinting",
        definition: "Instructions embedded in a font that nudge its outlines onto the pixel grid at small sizes, so curves don't blur or stems don't vanish on a low-resolution screen. Mostly a solved problem on today's high-DPI displays — modern fonts lean on that instead of manual hinting.",
      },
    ],
  },
  {
    title: "Families and variation",
    terms: [
      {
        term: "Typeface vs. font",
        definition: "A typeface is the overall design — 'Fontane Sketch'. A font is one specific weight/style file of it — 'Fontane Sketch Bold' is a font, part of the Fontane Sketch typeface.",
      },
      {
        term: "Weight",
        definition: "How thick a typeface's strokes are — Light, Regular, Bold, and everything between. Named after the OpenType wght axis, which runs roughly 100 (thinnest) to 900 (heaviest).",
      },
      {
        term: "Width",
        definition: "How condensed or expanded a typeface is horizontally, independent of its weight — the OpenType wdth axis. A Condensed Bold and a Regular Bold share a weight but not a width.",
      },
      {
        term: "Italic vs. oblique",
        definition: "An oblique is the upright letterforms mechanically slanted. A true italic is redrawn — different letter construction, not just a slant (a lowercase italic 'a' is often a completely different shape from its upright counterpart). The OpenType slnt axis technically produces an oblique; a true italic needs its own drawn master.",
      },
      {
        term: "Variable font",
        definition: "A single font file that contains a continuous design space — drag a Weight slider and every glyph interpolates live, instead of switching between separate Light/Regular/Bold files. Powered by axes like wght, wdth, and slnt.",
      },
      {
        term: "Named instance",
        definition: "A specific, labeled point inside a variable font's design space — 'Bold' might just mean 'wght 700' with every other axis at its default. A static font (like each file in a Light/Regular/Bold export) is the same idea frozen into its own independent file.",
      },
    ],
  },
  {
    title: "Fontane's own vocabulary",
    terms: [
      {
        term: "Skeleton / centerline",
        definition: "The raw pen path you actually draw — before any brush, nib, or pressure envelope turns it into a filled letterform. Fontane keeps the skeleton and the applied style as two separate layers, which is what makes swapping brushes on an already-drawn alphabet possible.",
      },
      {
        term: "Provenance",
        definition: "Fontane's term for a font's traceable drawing history — evidence that a glyph was actually hand-drawn over real time, rather than converted or generated. Checked before a font can publish to the Marketplace.",
      },
      {
        term: "Fill vs. stroke (Vector pen)",
        definition: "Two ways a Vector-tool path can render, chosen per path in the Path panel before you draw. Fill turns a closed path into a solid shape — or a hole cut into one, the classic way to draw the counter in an 'O'. Stroke inks a constant-width outline along the path instead, at an adjustable width — the only way an open path (one that never closes back on its own start point) becomes visible ink at all, since a fill has no interior to fill without one.",
      },
    ],
  },
];

export default function LexiconPage() {
  return (
    <>
      <PageviewTracker page="lexicon" />
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        background: "#eae8e0",
        color: "#1f1934",
        fontFamily: "var(--font-sans)",
        fontWeight: 400,
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 720, width: "100%" }}>
        <MarketplaceNav slug="lexicon" current="en" />

        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Type Lexicon</h1>
        <p style={{ marginBottom: 40, fontSize: 14, fontWeight: 400, lineHeight: 1.7, opacity: 0.75 }}>
          A small glossary of type-design terms, written for someone drawing their first font rather than
          someone who already has a shelf of typography books.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} style={{ marginBottom: 40 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: "1px solid rgba(31,25,52,0.15)",
              }}
            >
              {section.title}
            </h2>
            {section.terms.map((t) => (
              <div key={t.term} style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{t.term}</h3>
                <p style={{ fontSize: 14, fontWeight: 400, lineHeight: 1.7, opacity: 0.85 }}>{t.definition}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
    </>
  );
}
