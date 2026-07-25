import type { MetadataRoute } from "next";
import { LOCALES, TRANSLATABLE_PAGES, hreflangUrls, localizedPath, type TranslatableSlug } from "@/lib/i18n";

// changeFrequency/priority/lastModified per translated page — one entry
// here covers every locale of that page (see the flatMap below), instead of
// one hand-written sitemap object per locale.
const PAGE_META: Record<TranslatableSlug, { lastModified: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = {
  features: { lastModified: "2026-07-25", changeFrequency: "monthly", priority: 0.8 },
  legal: { lastModified: "2026-07-25", changeFrequency: "yearly", priority: 0.3 },
};

export default function sitemap(): MetadataRoute.Sitemap {
  const translatedEntries: MetadataRoute.Sitemap = TRANSLATABLE_PAGES.flatMap((slug) =>
    LOCALES.map(({ code }) => ({
      url: `https://fontane.studio${localizedPath(slug, code)}`,
      ...PAGE_META[slug],
      alternates: { languages: hreflangUrls(slug) },
    }))
  );

  return [
    {
      url: "https://fontane.studio",
      lastModified: "2026-07-25",
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://fontane.studio/marketplace",
      lastModified: "2026-07-18",
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://fontane.studio/lexicon",
      lastModified: "2026-07-25",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...translatedEntries,
  ];
}
