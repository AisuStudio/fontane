export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

// Same topology as the canvas fill: curve through each outline point to the midpoint
// with its neighbor. Keeping this as the one place that logic lives means the SVG
// export always matches what's drawn on screen.
export function outlineToPath(outline: [number, number][]): PathCommand[] {
  if (outline.length < 3) return [];
  const commands: PathCommand[] = [{ type: "M", x: outline[0][0], y: outline[0][1] }];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    commands.push({ type: "Q", cx: x0, cy: y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  commands.push({ type: "Z" });
  return commands;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pathToSvgD(commands: PathCommand[]): string {
  return commands
    .map((c) => {
      if (c.type === "M") return `M${round(c.x)} ${round(c.y)}`;
      if (c.type === "Q") return `Q${round(c.cx)} ${round(c.cy)} ${round(c.x)} ${round(c.y)}`;
      return "Z";
    })
    .join(" ");
}
