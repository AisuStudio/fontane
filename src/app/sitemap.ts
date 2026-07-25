import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
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
      url: "https://fontane.studio/features",
      lastModified: "2026-07-25",
      changeFrequency: "monthly",
      priority: 0.8,
      alternates: { languages: { en: "https://fontane.studio/features", de: "https://fontane.studio/de/features" } },
    },
    {
      url: "https://fontane.studio/de/features",
      lastModified: "2026-07-25",
      changeFrequency: "monthly",
      priority: 0.8,
      alternates: { languages: { en: "https://fontane.studio/features", de: "https://fontane.studio/de/features" } },
    },
    {
      url: "https://fontane.studio/legal",
      lastModified: "2026-07-25",
      changeFrequency: "yearly",
      priority: 0.3,
      alternates: { languages: { en: "https://fontane.studio/legal", de: "https://fontane.studio/de/legal" } },
    },
    {
      url: "https://fontane.studio/de/legal",
      lastModified: "2026-07-25",
      changeFrequency: "yearly",
      priority: 0.3,
      alternates: { languages: { en: "https://fontane.studio/legal", de: "https://fontane.studio/de/legal" } },
    },
  ];
}
