import Link from "next/link";
import LanguageSwitcher from "../LanguageSwitcher";
import BetaBadge from "../BetaBadge";
import type { LocaleCode } from "@/lib/i18n";
import styles from "../page.module.css";

// Info-page nav, styled off the app's own .menuBar/.menuTrigger/.appName
// classes (page.module.css) instead of its old one-off inline styles, so
// the editor and the marketing/legal pages read as the same product. The
// language toggle sits in this same row now — previously every page placed
// its own LanguageSwitcher next to its own <h1>, one more inconsistency
// between pages this removes. slug/current are passed through as-is: lexicon
// and marketplace aren't in TRANSLATABLE_PAGES (lib/i18n.ts), so passing
// their slug here just renders nothing (LanguageSwitcher's own no-op path).
export default function MarketplaceNav({ slug, current }: { slug: string; current: LocaleCode }) {
  return (
    <>
      <BetaBadge />
      <nav className={styles.menuBar} style={{ position: "relative", marginBottom: 32 }}>
        <span className={styles.appName}>Fontane.Studio</span>
        <Link href="/" className={styles.menuTrigger} style={{ textDecoration: "none" }}>
          Editor
        </Link>
        <Link href="/marketplace" className={styles.menuTrigger} style={{ textDecoration: "none" }}>
          Marketplace
        </Link>
        <Link href="/features" className={styles.menuTrigger} style={{ textDecoration: "none" }}>
          Features
        </Link>
        <Link href="/lexicon" className={styles.menuTrigger} style={{ textDecoration: "none" }}>
          Lexicon
        </Link>
        <Link href="/legal" className={styles.menuTrigger} style={{ textDecoration: "none" }}>
          Legal
        </Link>
        <span style={{ marginLeft: "auto" }}>
          <LanguageSwitcher slug={slug} current={current} />
        </span>
      </nav>
    </>
  );
}
