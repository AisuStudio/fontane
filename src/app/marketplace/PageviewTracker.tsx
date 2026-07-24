"use client";

import { useVisitTracking } from "@/lib/visitDuration";

// Marketplace pages are Server Components (no client JS otherwise), so
// tracking needs this tiny wrapper — it calls the exact same
// useVisitTracking() the main editor page uses, so marketplace visits land
// in the same aggregate pageview count AND get the same visible-time
// duration measurement, with the same production-only gating, IP exclusion,
// and ?notrack opt-out. Marketplace pages have no sub-views, so the
// duration label is just the page itself.
export default function PageviewTracker({ page = "marketplace" }: { page?: string }) {
  useVisitTracking(page);
  return null;
}
