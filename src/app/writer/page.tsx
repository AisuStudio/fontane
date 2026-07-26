import Writer from "./Writer";
import PageviewTracker from "../PageviewTracker";

// Graduated from unlinked prototype to a real (beta) feature — linked from
// the app's View menu as "Writer (BETA)", so unlike /vf and /anneliese this
// is meant to be found and indexed. Write a known coverage text with the
// stylus; segmentation is a plain x-gap heuristic against the known
// character sequence, not OCR/ML — see docs/writer-handover.md for the full
// design writeup and what's still open (ligature marking, "Add line",
// committing a result as a real Glyph).
export const metadata = {
  title: "writer (beta)",
  description:
    "Write a known coverage text with the stylus and let Fontane segment it into individual characters — no OCR, no ML, just position against a known sequence.",
};

export default function WriterPage() {
  return (
    <>
      <PageviewTracker page="writer" />
      <Writer />
    </>
  );
}
