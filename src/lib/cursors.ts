// Hover-contextual pen cursors (Illustrator parity): the pen tool tells you
// what a click would do BEFORE you click — a badge in the nib's corner flips
// as you cross a closable first anchor (o), the open path's last anchor (/),
// a segment (+), and so on. CSS keyword cursors can't do that, so these are
// hand-authored ~16x16 inline-SVG data URIs: one blueberry nib with a vanilla
// outline (readable on ink and cream alike) plus a per-variant badge, hotspot
// pinned at the nib tip (1 1). Every constant carries a builtin fallback
// keyword after the data URI, so a browser that refuses SVG cursors still
// shows something precise rather than the default arrow.

const INK = "#1f1934"; // blueberry — matches the app's stroke ink
const HALO = "#eae8e0"; // vanilla — same contrast ring the anchors use

// The nib: tip at (1,1) — where the hotspot sits — widening down-right, with
// a short vanilla slit so it reads as a pen and not an arrowhead.
const NIB =
  `<path d="M1 1 L7.7 3.2 L9.9 6.9 L6.9 9.9 L3.2 7.7 Z" fill="${INK}" stroke="${HALO}" stroke-width="1" stroke-linejoin="round"/>` +
  `<line x1="4.4" y1="4.4" x2="7.4" y2="7.4" stroke="${HALO}" stroke-width="0.8"/>`;

// Badges live in the free bottom-right quadrant. Each is drawn twice — a wide
// vanilla halo pass under a thin blueberry pass — so it stays legible over any
// canvas content; `stroke` is the attribute string for whichever pass is being
// drawn.
type BadgeMarks = (stroke: string) => string;

function penCursor(badgeMarks: BadgeMarks | null, fallback: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
    NIB +
    (badgeMarks
      ? badgeMarks(`stroke="${HALO}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`) +
        badgeMarks(`stroke="${INK}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`)
      : "") +
    `</svg>`;
  // Hotspot 1 1 = the nib tip, so the click lands exactly where the tip points.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 1 1, ${fallback}`;
}

// Plain pen — a click places/extends.
export const PEN = penCursor(null, "crosshair");
// + badge — a click inserts an anchor on the segment under the cursor.
export const PEN_ADD = penCursor(
  (s) =>
    `<line x1="10" y1="12.5" x2="15" y2="12.5" ${s}/>` +
    `<line x1="12.5" y1="10" x2="12.5" y2="15" ${s}/>`,
  "crosshair"
);
// − badge — a click deletes the anchor under the cursor.
export const PEN_MINUS = penCursor(
  (s) => `<line x1="10" y1="12.5" x2="15" y2="12.5" ${s}/>`,
  "crosshair"
);
// o badge — a click closes the open path (hovering its first anchor).
export const PEN_CLOSE = penCursor(
  (s) => `<circle cx="12.5" cy="12.5" r="2.4" fill="none" ${s}/>`,
  "crosshair"
);
// Slash badge — hovering the open path's own last anchor: a click continues
// from here (retracts the outgoing handle so the next segment leaves straight).
export const PEN_CONTINUE = penCursor(
  (s) => `<line x1="10" y1="15" x2="15" y2="10" ${s}/>`,
  "crosshair"
);
// Caret badge — the Convert Anchor gesture (Alt over a smooth point).
export const CONVERT = penCursor(
  (s) => `<path d="M10 14.2 L12.5 10.6 L15 14.2" fill="none" ${s}/>`,
  "crosshair"
);

// What a plain pen click on a non-endpoint anchor of the editing shape does —
// the user chose Illustrator's "select" over Glyphs' "delete". Both canvases'
// hover + pointerup logic branch on this constant, so flipping it to "delete"
// later (a) shows PEN_MINUS over such an anchor and (b) enables the
// click-not-drag delete branch in the vector pointerup handlers. With
// "select" (the default) no delete ever happens and the hover cursor there is
// the plain arrow.
export const PEN_ANCHOR_CLICK: "select" | "delete" = "select";
