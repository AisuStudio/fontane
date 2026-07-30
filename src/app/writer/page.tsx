import { redirect } from "next/navigation";

// Writer graduated again — from its own standalone route to a real fourth
// view inside the app itself (topMode==="draw", drawStyle==="writer"),
// sharing the menu bar, view tabs, BetaBadge, and Tools-row visibility with
// Grid/Sketcher/Typer instead of duplicating them. This route stays only so
// existing bookmarks/links to /writer keep working — page.tsx's own
// ?view=writer effect (next to topMode/drawStyle) picks it up on load.
export default function WriterPage() {
  redirect("/?view=writer");
}
