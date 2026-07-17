import type { MetadataRoute } from "next";

// No Disallow rules anywhere — this is a small public tool, everything is
// meant to be crawled and indexed, including by AI answer engines/crawlers
// (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, etc.), which all fall
// under the "*" wildcard below. /anneliese (the analytics page) is
// deliberately unlisted rather than disallowed — a Disallow would just draw
// attention to it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://fontane.studio/sitemap.xml",
  };
}
