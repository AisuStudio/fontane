"use client";

import { useState } from "react";

// Same idle/copied/failed pattern as AnimatePanel's "Copy embed code" —
// navigator.clipboard.writeText can reject (unfocused doc, no permission),
// so this always shows real success/failure instead of assuming it worked.
export default function ShareButton({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  function handleShare() {
    const url = `${window.location.origin}/marketplace/${slug}`;
    navigator.clipboard
      .writeText(url)
      .then(() => setState("copied"))
      .catch(() => setState("failed"));
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      onClick={handleShare}
      style={{
        font: "inherit",
        padding: "10px 20px",
        borderRadius: 6,
        border: "1px solid rgba(31,25,52,0.3)",
        background: "transparent",
        color: "#1f1934",
        cursor: "pointer",
      }}
    >
      {state === "copied" ? "Link copied!" : state === "failed" ? "Copy failed" : "Share"}
    </button>
  );
}
