import { ImageResponse } from "next/og";

export const alt = "Fontane.Studio — hand lettering, turned into a font";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#eae8e0",
          padding: "80px",
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "#1f1934",
            letterSpacing: "-0.02em",
          }}
        >
          Fontane.Studio
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 36,
            color: "#1f1934",
            opacity: 0.75,
          }}
        >
          Hand lettering, captured with pressure, turned into a font.
        </div>
        <div
          style={{
            marginTop: 56,
            width: 120,
            height: 12,
            background: "#5100ff",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
