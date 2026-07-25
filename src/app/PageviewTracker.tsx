"use client";

import { useVisitTracking } from "@/lib/visitDuration";

// Every page except the editor is a Server Component (no client JS
// otherwise), so tracking needs this tiny wrapper — it calls the exact same
// useVisitTracking() the editor does, so those visits land in the same
// aggregate pageview count AND get the same visible-time duration
// measurement, with the same production-only gating, IP exclusion, and
// ?notrack opt-out. These pages have no sub-views, so the duration label is
// just the page itself.
//
// It lives at the app root rather than under marketplace/ because it is not
// a marketplace concern: /features, /legal and /vf went unmeasured for their
// whole life purely because the only copy of this component sat in a folder
// they had no reason to import from. /features in particular is the page
// written for AI answer engines (see its jsonLd) — the one surface whose
// entire job is acquisition, and the one we could say least about.
export default function PageviewTracker({ page = "marketplace" }: { page?: string }) {
  useVisitTracking(page);
  return null;
}
