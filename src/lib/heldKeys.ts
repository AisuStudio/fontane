// Live "which modifier keys are down right now" state — a module-level
// singleton (same cross-canvas pattern as clipboard.ts), NOT React state and
// not per-component: pointer handlers on the Free canvas AND every Grid cell
// read it mid-gesture at native-event rate, where a re-render round-trip
// would be both too slow and N-times duplicated. Keyboard events carry
// modifier flags themselves, but pointermove is what needs them (Illustrator
// reads Shift/Cmd LIVE during a drag, not as-of-pointerdown) and a
// mousemove's own e.shiftKey isn't available inside handlers that only get
// (x, y) passed down — this keeps those signatures untouched.

export type HeldKeys = {
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  space: boolean;
};

const held: HeldKeys = { alt: false, meta: false, ctrl: false, shift: false, space: false };

let initialized = false;

// Both keydown and keyup funnel through here: every KeyboardEvent reports the
// full current modifier state (e.altKey is already false on the Alt key's own
// keyup), so mirroring the flags wholesale is self-correcting. Space is the
// one non-modifier tracked (the momentary-pan key) — it has no e.spaceKey, so
// its state comes from which event type saw it.
function syncFromEvent(e: KeyboardEvent) {
  held.alt = e.altKey;
  held.meta = e.metaKey;
  held.ctrl = e.ctrlKey;
  held.shift = e.shiftKey;
  if (e.code === "Space") held.space = e.type === "keydown";
}

// The Cmd+Tab stuck-modifier trap: a key released while the window is blurred
// or the tab hidden never delivers its keyup here, so without this a modifier
// pressed on the way out (Cmd, during Cmd+Tab itself) would read as held
// forever. Losing focus/visibility clears everything; the worst case is the
// user re-pressing a genuinely-still-held key, not a permanently stuck one.
function clearAll() {
  held.alt = false;
  held.meta = false;
  held.ctrl = false;
  held.shift = false;
  held.space = false;
}

// Idempotent — page.tsx calls it once on mount and every GridCell calls it
// again from its own mount effect (N cells, one registration). SSR-safe: on
// the server it does nothing and every flag just stays false.
export function initHeldKeys() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("keydown", syncFromEvent);
  window.addEventListener("keyup", syncFromEvent);
  window.addEventListener("blur", clearAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearAll();
  });
}

// Returns the live object itself (not a copy) — callers read a flag or two
// per pointer event, and the object's identity never changes.
export function getHeldKeys(): HeldKeys {
  return held;
}
