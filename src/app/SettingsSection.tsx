"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import styles from "./page.module.css";
import { loadSectionOpen, saveSectionOpen } from "@/lib/uiPrefs";

// Glyphs' collapsible palette sections are the model: every group of
// controls in the right-hand palette sits under a disclosure header, each
// section remembers its own open/closed state across sessions, and a closed
// section takes up nothing but its header row. Closed = children UNMOUNTED
// (not display:none) — the sliders inside are plain controlled inputs, so
// there's no local state to lose, and unmounting keeps the collapsed
// palette from paying for controls nobody can see.
type Props = {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export default function SettingsSection({ id, title, defaultOpen, children }: Props) {
  // Lazy init straight from localStorage (uiPrefs.ts) — the stored value
  // wins over defaultOpen, so a section the user closed stays closed.
  const [open, setOpen] = useState(() => loadSectionOpen(id, defaultOpen ?? true));

  function toggle() {
    const next = !open;
    setOpen(next);
    saveSectionOpen(id, next);
  }

  return (
    <div>
      <button type="button" className={styles.sectionHeader} onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}
