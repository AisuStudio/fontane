import type { Metadata, Viewport } from "next";
import "./tokens.css";
import "./globals.css";

const description = "Hand lettering, captured with pressure, turned into a font.";

export const metadata: Metadata = {
  metadataBase: new URL("https://fontane.studio"),
  title: "Fontane.Studio",
  description,
  keywords: [
    "hand lettering",
    "font creator",
    "handwriting to font",
    "OTF export",
    "TTF export",
    "type design tool",
    "calligraphy font",
  ],
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fontane.Studio",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Fontane.Studio",
    description,
    url: "https://fontane.studio",
    siteName: "Fontane.Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fontane.Studio",
    description,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Fontane.Studio",
  url: "https://fontane.studio",
  description,
  applicationCategory: "DesignApplication",
  operatingSystem: "Any (runs in the browser)",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Draw letters freehand or in a letter grid",
    "Pressure-sensitive stroke capture (Apple Pencil, Wacom, mouse)",
    "Export as OTF, skeleton SVG, or FFF project file",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1f1934",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
