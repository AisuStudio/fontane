import type { Metadata } from "next";
import MarketplaceNav from "../marketplace/MarketplaceNav";
import PageviewTracker from "../PageviewTracker";
import LanguageSwitcher from "../LanguageSwitcher";
import { hreflangPaths } from "@/lib/i18n";

const description =
  "Every feature of Fontane.Studio: pressure-sensitive hand-lettering capture, an Illustrator-grade Bezier pen with smooth anchors and held-key modifiers, Grid and Free drawing, ligatures and alternates, copy/paste across views, and instant OTF export — all running in the browser, free.";

export const metadata: Metadata = {
  title: "Features — Fontane.Studio",
  description,
  alternates: {
    canonical: "/features",
    languages: hreflangPaths("features"),
  },
  openGraph: {
    title: "Features — Fontane.Studio",
    description,
    url: "https://fontane.studio/features",
    siteName: "Fontane.Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Features — Fontane.Studio",
    description,
  },
};

// Richer than the root layout's brief 3-item featureList (see layout.tsx) —
// this is the page AI answer engines (ChatGPT, Perplexity, Google AI
// Overviews — see robots.ts's explicit allow-list for their crawlers) should
// land on when asked "what can Fontane.Studio do", so every real feature
// gets its own atomic, quotable sentence rather than being folded into prose.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Fontane.Studio",
  url: "https://fontane.studio",
  applicationCategory: "DesignApplication",
  operatingSystem: "Any (runs in the browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Pressure-sensitive freehand drawing with Apple Pencil, Wacom, or a mouse",
    "Calligraphy tool: a broad-nib pen with fixed size/oval/angle, width from stroke direction rather than pressure",
    "Grid View with per-character guides (ascender, x-height, baseline, descender) and adjustable side bearings, with a Lock Bearings toggle so drawing over a bearing draws instead of dragging it",
    "Illustrator-style vector pen family: Pen, Add Anchor, Delete Anchor, and Convert Anchor tools on familiar shortcuts (P, +, -, C)",
    "Smooth anchor points with tangent-continuity handles — dragging one handle keeps the opposite one aligned at its own length, Alt breaks the pair, double-click toggles smooth/corner",
    "Held-key modifiers like a desktop pen tool: Cmd for momentary direct selection, Shift for 45-degree constraints, Space to pan, Esc/Enter to end a path — with context-aware pen cursors for add, close, and continue",
    "The vector pen works inside Grid cells too, with shapes auto-tagged to the cell's character",
    "Letter counters two ways: a vector shape nested inside another becomes the counter (draw a 'B' or 'O' in pure vector), and closed shapes punch holes through overlapping strokes",
    "Anchor and Nudge tools to reshape already-drawn strokes point by point",
    "Compact, context-aware workspace: Illustrator-style tool-group flyouts and a Glyphs-style settings palette that shows only what the active tool uses",
    "Character set library: Latin Basic, Central European accents, punctuation, and currency/math symbols",
    "Ligatures and stylistic alternates, tagged and exported as real OpenType substitution glyphs",
    "Copy and paste strokes and vector shapes within Free Draw, within Grid, and between the two",
    "Move, rotate, and scale tools for reshaping and repositioning drawn letters",
    "Illustrator-style momentary Select: hold Cmd (or Ctrl) while Draw, Brush, Calligraphy, or Eraser is active to lasso-select strokes, release to keep drawing with the same tool",
    "Editor view to type live preview text using your own tagged glyphs",
    "Animate mode: CSS-driven text animations exportable as a self-contained HTML embed",
    "Instant OTF font export, generated entirely client-side, no upload required",
    "Skeleton SVG export for manual refinement in Glyphs.app or other type tools",
    "FFF project files to save and resume a font in progress",
    "Glyphs.app import script for glyph-level fine-tuning by professional type designers",
    "Marketplace to publish, browse, and download fonts made by other users",
    "Provenance verification gate that checks a font was actually hand-drawn before it can be published",
    "No cookies, no third-party trackers, GDPR-safe anonymous analytics",
    "Installable as a Progressive Web App, works entirely in the browser",
  ],
};

type Feature = { name: string; description: string };
type Section = { title: string; features: Feature[] };

const SECTIONS: Section[] = [
  {
    title: "Draw & capture",
    features: [
      {
        name: "Free Draw",
        description:
          "A freeform canvas for sketching letters exactly as you would on paper, with real pressure-sensitive stroke width from Apple Pencil, Wacom, or a mouse.",
      },
      {
        name: "Grid View",
        description:
          "One cell per character, with ascender, x-height, baseline, and descender guides plus draggable side bearings — the systematic way to draw a full alphabet. A Lock Bearings toggle freezes the bearings so drawing over one draws instead of dragging it.",
      },
      {
        name: "Mono line & Dynamic strokes",
        description: "Switch between constant-width ink and pressure-responsive thickness, with live size/thinning/smoothing/streamline controls.",
      },
      {
        name: "Swappable brushes",
        description:
          "One skeleton, many typefaces: the drawn path stays the source, and the brush applied to it — pressure envelope, swept calligraphy nib, or stipple stamps at your own spacing, rotation and jitter — is swapped at any time and restyles every letter at once.",
      },
      {
        name: "Calligraphy",
        description:
          "A dedicated broad-nib pen: an oval held at a fixed size, roundness, and angle, dragged along your stroke — width comes from the direction you move, not how hard you press, the classic broad-pen hand (Italic, Gothic) rather than pressure-based contrast.",
      },
    ],
  },
  {
    title: "Precision vector tools",
    features: [
      {
        name: "Vector pen family",
        description:
          "A true Bezier pen with the full Illustrator toolset — Pen (P), Add Anchor (+, inserts without changing the curve), Delete Anchor (-), and Convert Anchor (C) — working in Free Draw and directly inside Grid cells, where shapes auto-tag to the cell's character.",
      },
      {
        name: "Smooth anchors & held-key modifiers",
        description:
          "Smooth points keep their handles in tangent continuity; Alt breaks the pair, double-click toggles smooth/corner. Hold Cmd for momentary direct selection, Shift for 45° constraints, Space to pan, Esc to end a path — and the pen cursor tells you what a click will do before you do it.",
      },
      {
        name: "Counters",
        description:
          "Draw a shape inside another and it becomes the counter — a 'B' or 'O' works in pure vector. Where strokes are involved, closed shapes punch holes through them instead, the classic way to cut an 'o' or 'e'.",
      },
      {
        name: "Anchor & Nudge",
        description: "Reshape an already-drawn freehand stroke by dragging, inserting, or deleting its own anchor points, without redrawing it.",
      },
    ],
  },
  {
    title: "Organize your alphabet",
    features: [
      {
        name: "Character sets",
        description:
          "New fonts start focused on Latin Basic (a–z, A–Z); toggle Central European accents, Western European, numbers, punctuation, and symbols on whenever you're ready — glyphs you've already drawn always keep their cell.",
      },
      {
        name: "Ligatures & alternates",
        description: "Tag a drawn shape as a ligature (e.g. 'fi') or a stylistic alternate of an existing letter — both export as real OpenType substitution glyphs.",
      },
      {
        name: "Custom glyphs",
        description: "Add any one-off base character, ligature, or alternate outside the built-in sets by name.",
      },
    ],
  },
  {
    title: "Edit & arrange",
    features: [
      {
        name: "Select, Move, Rotate, Scale",
        description:
          "Lasso-select any combination of strokes and vector shapes, then transform them as a group. Hold Cmd/Ctrl while Draw, Brush, Calligraphy, or Eraser is active for a momentary Select, Illustrator-style — release and you're back to drawing.",
      },
      {
        name: "Copy & paste",
        description:
          "Duplicate strokes and shapes within Free Draw, within Grid, or across the two — paste into a different Grid cell and it's automatically fitted to size.",
      },
      {
        name: "Undo/redo",
        description: "A full history stack covering drawing, tagging, and transform actions.",
      },
      {
        name: "Focused workspace",
        description:
          "Related tools stack into Illustrator-style flyout slots (long-press to expand), and the settings palette shows only what the active tool actually uses — Glyphs-style collapsible sections, with a live Path info box while you're on the pen.",
      },
    ],
  },
  {
    title: "Compose & preview",
    features: [
      {
        name: "Editor view",
        description: "Type freely using your own already-tagged glyphs to see how your in-progress font reads as real text.",
      },
      {
        name: "Animate",
        description: "Apply CSS-driven animations (pulse, tilt, glitch, and more) to your lettering and export it as a self-contained HTML embed.",
      },
    ],
  },
  {
    title: "Export anywhere",
    features: [
      {
        name: "OTF export",
        description: "A complete OpenType font file, compiled entirely in your browser — nothing is uploaded, nothing to install.",
      },
      {
        name: "Skeleton SVG export",
        description: "The raw stroke centerlines as an open SVG path, ready to bring into Glyphs.app or another vector tool for manual refinement.",
      },
      {
        name: "FFF project files",
        description: "Fontane's own save format — every stroke, glyph, and setting, so you can pause and resume a font later or move between devices.",
      },
      {
        name: "Glyphs.app import script",
        description: "A Python script for Glyphs.app that reads an FFF file directly and builds real glyphs with correct components and Bezier nodes.",
      },
    ],
  },
  {
    title: "Share your font",
    features: [
      {
        name: "Marketplace",
        description: "Publish a finished font for anyone to browse and download, or share a direct link to it.",
      },
      {
        name: "Provenance gate",
        description: "Before a font can be published, Fontane checks for a plausible history of real drawing activity — a lightweight guard against converted or stolen fonts.",
      },
    ],
  },
  {
    title: "Built for privacy",
    features: [
      {
        name: "No trackers",
        description: "No cookies, no third-party analytics or ad scripts, no persistent identifier written to your device.",
      },
      {
        name: "Local-first",
        description: "Your drawings live in your browser's own storage — nothing reaches our servers unless you explicitly export or publish.",
      },
    ],
  },
];

export default function FeaturesPage() {
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
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Features</h1>
          <LanguageSwitcher slug="features" current="en" />
        </div>
        <p style={{ marginBottom: 40, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          Everything Fontane.Studio can do today, running entirely in your browser — from a first pressure-sensitive
          sketch to a finished, exportable font.
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
