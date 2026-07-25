// Single source of truth for which languages the marketing/legal pages
// (features, legal — NOT the tool itself, which stays English-only) exist
// in. Adding a language is meant to mean: add one entry here, then create
// the actual `/xx/<slug>/page.tsx` content file — every hreflang tag,
// sitemap entry, and switcher link on every EXISTING page updates itself,
// nothing else needs to be touched.
//
// Routing convention: the default locale lives unprefixed (`/features`),
// every other locale lives under its code (`/de/features`). That one rule
// is what lets localizedPath() below be pure arithmetic instead of a
// per-page lookup table.
export type LocaleCode = "en" | "de";

export const DEFAULT_LOCALE: LocaleCode = "en";

export const LOCALES: { code: LocaleCode; label: string; name: string }[] = [
  { code: "en", label: "EN", name: "English" },
  { code: "de", label: "DE", name: "Deutsch" },
];

// A "translatable page" is anything with one URL per locale — features,
// legal, and (later) whatever else joins them. `slug` is the path segment
// shared by every locale's copy of the page (English: `/${slug}`, German:
// `/de/${slug}`), so it must match the actual folder name under both
// `src/app/` and `src/app/<locale>/`.
export const TRANSLATABLE_PAGES = ["features", "legal"] as const;
export type TranslatableSlug = (typeof TRANSLATABLE_PAGES)[number];

export function localizedPath(slug: string, locale: LocaleCode): string {
  return locale === DEFAULT_LOCALE ? `/${slug}` : `/${locale}/${slug}`;
}

// For Next.js Metadata.alternates.languages — every locale's path for a
// given page, keyed by locale code, so hreflang stays complete and correct
// even as LOCALES grows.
export function hreflangPaths(slug: string): Record<LocaleCode, string> {
  return Object.fromEntries(LOCALES.map(({ code }) => [code, localizedPath(slug, code)])) as Record<
    LocaleCode,
    string
  >;
}

// For sitemap.ts: the same map, but with full https://fontane.studio URLs
// (Next's sitemap alternates want absolute URLs, unlike page-level metadata).
export function hreflangUrls(slug: string): Record<LocaleCode, string> {
  return Object.fromEntries(
    LOCALES.map(({ code }) => [code, `https://fontane.studio${localizedPath(slug, code)}`])
  ) as Record<LocaleCode, string>;
}

// For the on-page language switcher: every locale except the one you're
// already reading, each with the URL of ITS version of the current page.
export function otherLocales(slug: string, current: LocaleCode) {
  return LOCALES.filter((l) => l.code !== current).map((l) => ({ ...l, href: localizedPath(slug, l.code) }));
}
