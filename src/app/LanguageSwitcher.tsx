import Link from "next/link";
import { otherLocales, type LocaleCode } from "@/lib/i18n";

// Every translated page (features, legal, ...) renders this instead of its
// own hardcoded "EN"/"DE" link — add a locale to LOCALES in lib/i18n.ts and
// every one of these updates itself, no per-page edits needed.
export default function LanguageSwitcher({ slug, current }: { slug: string; current: LocaleCode }) {
  const others = otherLocales(slug, current);
  if (others.length === 0) return null;
  return (
    <span style={{ display: "flex", gap: 12 }}>
      {others.map((l) => (
        <Link key={l.code} href={l.href} style={{ color: "#1f1934", opacity: 0.6, fontSize: 13, textDecoration: "none" }}>
          {l.label}
        </Link>
      ))}
    </span>
  );
}
