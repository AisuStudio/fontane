import VfLab from "./VfLab";
import PageviewTracker from "../PageviewTracker";

// Deliberately not in any nav/sitemap and not disallowed in robots.txt either
// (a Disallow would just draw attention to it) — reachable only by URL, same
// pattern as /anneliese. Private playground: Animate × Variable on the
// user's own drawn glyphs (VF-Spike Stufe 2, council round 2).
export const metadata = {
  title: "vf lab",
  robots: { index: false, follow: false },
};

export default function VfPage() {
  return (
    <>
      {/* Private today, but the moment it's handed to a beta tester the
          question "did anyone open it, and for how long" becomes real —
          and self-traffic is already excluded by IP (api/track/route.ts). */}
      <PageviewTracker page="vf" />
      <VfLab />
    </>
  );
}
