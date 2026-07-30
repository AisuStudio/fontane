"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import styles from "./page.module.css";

type Placement = "bottom" | "left" | "center";

type CoachStep = {
  target: string | null; // matches an element's data-tour attribute; null = centered, no target
  placement: Placement;
  title: string;
  body: string;
};

// Views + settings, in the order they actually sit on screen top-to-bottom,
// left-to-right — not the full feature set (that's what /features is for).
// "Cell settings" is one stop covering Cell size/Width/Bearings/Reference
// Letterform together, matching how they're already grouped under one
// collapsible section, rather than three separate stops pointing at the
// same header.
const COACH_STEPS: CoachStep[] = [
  {
    target: "grid",
    placement: "bottom",
    title: "Grid View",
    body: "This is your alphabet grid — one cell per letter.",
  },
  {
    target: "view-tabs",
    placement: "bottom",
    title: "Switch views anytime",
    body: "Sketcher for free writing, Typer to test your letters as running text, Writer to copy a printed line with the stylus.",
  },
  {
    target: "tools",
    placement: "bottom",
    title: "Your drawing tools",
    body: "Draw, Vector, Brush, Calligraphy, Erase, Select, Move.",
  },
  {
    target: "cell-settings",
    placement: "left",
    title: "Cell settings",
    body: "Resize the grid, set the spacing (bearings) around each letter, and toggle the faint reference letterform.",
  },
  {
    target: "metrics",
    placement: "left",
    title: "Metrics",
    body: "Ascender, baseline, descender, x-height — the four lines every letter sits on.",
  },
  {
    target: "stroke",
    placement: "left",
    title: "Stroke",
    body: "Pick a brush, mono or dynamic width, adjust thickness.",
  },
  {
    target: "charsets",
    placement: "bottom",
    title: "Character Sets",
    body: "Add more alphabets anytime — Cyrillic, Greek, Central European.",
  },
  {
    target: null,
    placement: "center",
    title: "That's it",
    body: "Start drawing, or explore Marketplace and Features later.",
  },
];

const CALLOUT_WIDTH = 300;
const MARGIN = 12;

export default function CoachMarks({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = COACH_STEPS[index];

  // Re-measures on every step change (and window resize) rather than once —
  // a step's target can be a different size/position than the last one, and
  // the settings-panel headers move if the panel was just toggled.
  useLayoutEffect(() => {
    function measure() {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) {
        // Target isn't in the DOM in the current view (e.g. tour was
        // restarted from Sketcher) — skip this step rather than getting
        // stuck pointing at nothing.
        setIndex((i) => (i < COACH_STEPS.length - 1 ? i + 1 : i));
        if (index >= COACH_STEPS.length - 1) onFinish();
        return;
      }
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function next() {
    if (index < COACH_STEPS.length - 1) setIndex(index + 1);
    else onFinish();
  }
  function back() {
    if (index > 0) setIndex(index - 1);
  }

  // Classic spotlight trick: one box, sized to the target, whose shadow
  // spreads 9999px beyond it — dims the whole viewport except a cutout at
  // the target's rect. Tried a single box-shadow-spread trick first; it
  // measured correctly but rendered inconsistently (huge spreads are
  // apparently not reliable everywhere), so this is four ordinary bands
  // (top/bottom/left/right of the rect) instead — more elements, but each
  // one is a plain bounded rectangle, nothing relies on an oversized shadow.
  // Plain black, not the app's own blueberry ink (#1f1934) — the settings
  // panel's background IS blueberry, so a same-colored overlay dims the
  // light canvas fine but is invisible on the panel itself (dark-on-dark).
  // Black darkens both.
  const DIM = "rgba(0, 0, 0, 0.55)";
  const bandBase: CSSProperties = { position: "fixed", background: DIM, pointerEvents: "none", zIndex: 60 };
  const pad = 4;
  const bands: CSSProperties[] = rect
    ? [
        { ...bandBase, top: 0, left: 0, right: 0, height: Math.max(0, rect.top - pad) },
        { ...bandBase, top: rect.bottom + pad, left: 0, right: 0, bottom: 0 },
        { ...bandBase, top: rect.top - pad, height: rect.height + pad * 2, left: 0, width: Math.max(0, rect.left - pad) },
        { ...bandBase, top: rect.top - pad, height: rect.height + pad * 2, left: rect.right + pad, right: 0 },
      ]
    : [{ ...bandBase, inset: 0 }];

  const calloutStyle: CSSProperties = (() => {
    if (!rect || step.placement === "center") {
      return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CALLOUT_WIDTH };
    }
    if (step.placement === "left") {
      return {
        position: "fixed",
        top: Math.min(rect.top, window.innerHeight - 220),
        left: Math.max(MARGIN, rect.left - CALLOUT_WIDTH - MARGIN),
        width: CALLOUT_WIDTH,
      };
    }
    // "bottom" placement — but a target can be taller than the viewport
    // (the grid itself, scrollable), so anchor off its VISIBLE top/bottom
    // edges, not its true (possibly off-screen) ones, and flip above when
    // there isn't room below.
    const EST_HEIGHT = 180;
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    let top: number;
    if (visibleBottom + MARGIN + EST_HEIGHT <= window.innerHeight) {
      top = visibleBottom + MARGIN;
    } else if (visibleTop - MARGIN - EST_HEIGHT >= 0) {
      top = visibleTop - MARGIN - EST_HEIGHT;
    } else {
      top = Math.max(MARGIN, (window.innerHeight - EST_HEIGHT) / 2);
    }
    return {
      position: "fixed",
      top,
      left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - CALLOUT_WIDTH - MARGIN)),
      width: CALLOUT_WIDTH,
    };
  })();

  return (
    <>
      {bands.map((band, i) => (
        <div key={i} style={band} />
      ))}
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 6,
            outline: "2px solid #d8ff01",
            pointerEvents: "none",
            zIndex: 60,
          }}
        />
      )}
      <div className={styles.introCard} style={{ ...calloutStyle, zIndex: 61 }}>
        <div className={styles.coachStepCount}>
          {index + 1} / {COACH_STEPS.length}
        </div>
        <h3 className={styles.introSubtitle} style={{ marginTop: 0 }}>
          {step.title}
        </h3>
        <p className={styles.introText}>{step.body}</p>
        <div className={styles.coachActions}>
          <button type="button" className={styles.coachSkip} onClick={onFinish}>
            Skip
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {index > 0 && (
              <button type="button" className={styles.clearBtn} onClick={back}>
                Back
              </button>
            )}
            <button type="button" className={styles.clearBtn} onClick={next}>
              {index === COACH_STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
