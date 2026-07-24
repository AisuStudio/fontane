"use client";

import { useEffect, useRef } from "react";
import { trackPageview, trackDuration } from "./analytics";

// One pageview beacon per mount plus visible-time duration beacons, shared
// by every surface that wants them (the editor and the marketplace pages),
// so the measurement rules live in exactly one place.
//
// Duration counts only VISIBLE time, accumulated across visibility
// segments. An earlier version sent wall-clock-since-mount on every
// pagehide: a tab left open overnight reported a 10-hour "visit", and a
// bfcache-restored session re-reported its full cumulative time on every
// app switch — which is how /anneliese's average climbed to 26m56s while
// the median visit was 31s. Counters reset after each send, so a session
// spanning several pagehides (or several views) emits disjoint segments
// that sum to the true visible time instead of multiply-counting it.
//
// `page` is the coarse surface ("editor" | "marketplace" |
// "marketplace-listing") and is what the pageview row carries — the
// marketplace browse→download ratio counts those exact values, so it must
// stay coarse. `view` is the finer label duration rows carry (e.g.
// "editor:grid"), and switching views closes the running segment and opens
// a new one, which is what makes per-view time add up.
export function useVisitTracking(page: string, view: string = page) {
  const viewRef = useRef(view);
  // Set by the mount effect, read by the view-change effect below — the two
  // have to share one accumulator, since a view switch is just another
  // segment boundary in the same visit.
  const controls = useRef<{ closeAndSend: (label: string) => void; reopen: () => void } | null>(null);

  useEffect(() => {
    trackPageview(page);
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let accumulatedMs = 0;

    function closeSegment() {
      if (visibleSince !== null) {
        accumulatedMs += performance.now() - visibleSince;
        visibleSince = null;
      }
    }
    function reopen() {
      if (visibleSince === null && document.visibilityState === "visible") visibleSince = performance.now();
    }
    function closeAndSend(label: string) {
      closeSegment();
      trackDuration(accumulatedMs / 1000, label); // trackDuration itself drops < 1s
      accumulatedMs = 0;
    }
    function onVisibilityChange() {
      // Also reopens a segment on bfcache restore — the hidden→visible
      // transition fires visibilitychange when the page comes back.
      if (document.visibilityState === "hidden") closeSegment();
      else reopen();
    }
    function onPageHide() {
      closeAndSend(viewRef.current);
    }

    controls.current = { closeAndSend, reopen };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
      controls.current = null;
    };
    // `page` is fixed per surface; re-running this on it would double-count
    // the pageview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip the mount run — there's no previous view to close out yet.
    if (viewRef.current === view) return;
    controls.current?.closeAndSend(viewRef.current);
    viewRef.current = view;
    controls.current?.reopen();
  }, [view]);
}
