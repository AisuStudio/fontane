// The Hangul grid, as a sequence rather than a wall.
//
// 94 cells in one scroll (14 syllables + 24 jamo + 42 variants) give no clue
// what to do first or why, and the order matters more here than anywhere else
// in the app: the syllables are where stroke weight is established, because a
// part drawn inside a syllable maps 1:1 onto the em while a jamo drawn alone
// gets scaled INTO its slot afterwards — weight and all. So the sequence puts
// the undistorted thing first.
//
// The tension worth naming: the recommended order is not the required order.
// The 24 jamo are what covers all 11.172 syllables; the syllables and the
// variants are optional quality. That is expressed by numbering and by the
// `goal` line, and deliberately NOT by locking anything — a designer who wants
// to draw ㅁ right now must be able to.
//
// Pure and React-free, like hangul.ts next door: the step table is worth being
// able to read in one place without a 7.000-line component around it.

export type GridStepDef = {
  id: string;
  label: string;
  example: string; // a syllable/jamo that shows what this step is about
  goal: string; // the one line under the label
  required: boolean;
  // Which gridGroups belong to this step. A step with more than one keeps the
  // "Jump to" row; a step with one doesn't need it.
  groupIds: string[];
};

export const HANGUL_STEPS: GridStepDef[] = [
  {
    id: "step-syllables",
    label: "Syllables",
    example: "각",
    goal: "Optional — but do it first: this is where the stroke weight comes from.",
    required: false,
    groupIds: ["grp-syllables"],
  },
  {
    id: "step-jamo",
    label: "Jamo",
    example: "ㄱ",
    goal: "Required — these 24 cover all 11,172 syllables.",
    required: true,
    groupIds: ["grp-basic"],
  },
  {
    id: "step-variants",
    label: "Variants",
    example: "각",
    goal: "Optional refinement — a consonant drawn for the place it actually sits.",
    required: false,
    groupIds: ["grp-initV", "grp-initH", "grp-fin"],
  },
];

// Where the flow currently points: the first step that isn't finished, and the
// last one once everything is. Only a suggestion — it drives one marker and
// the initial landing step, never what is reachable.
export function recommendedStepId(progress: Record<string, { done: number; total: number }>): string {
  const unfinished = HANGUL_STEPS.find((s) => {
    const p = progress[s.id];
    return !p || p.total === 0 || p.done < p.total;
  });
  return (unfinished ?? HANGUL_STEPS[HANGUL_STEPS.length - 1]).id;
}
