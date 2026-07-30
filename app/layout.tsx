import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Montserrat, Jost } from "next/font/google";
import "./tokens.css";
import "./globals.css";
import { StorageBanner } from "@/components/StorageBanner";
import { ToastHost } from "@/components/ui/Toast";

// Courier Prime is the screen-friendly Courier preferred by the spec.
// Exposed as a CSS variable so the editor can switch fonts at runtime.
const courierPrime = localFont({
  src: [
    {
      path: "../public/fonts/CourierPrime-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/CourierPrime-Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../public/fonts/CourierPrime-Bold.ttf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/CourierPrime-BoldItalic.ttf",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-courier-prime",
  display: "swap",
});

// Free, self-hosted stand-ins for two licensed fonts, used only as the fallback
// when the real font is not installed locally: Montserrat ~ Proxima Nova,
// Jost ~ Futura. Plain documents only, never screenplays. These stay on
// next/font/google deliberately: naming the family in CSS instead would only
// work for writers who happen to have it installed, which silently downgrades
// the two document font choices that depend on them.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});
const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LESS: Last Ever Screenwriting Software",
  description:
    "A free, fast, web-based screenwriting app that respects your time and never holds your scripts hostage.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // suppressHydrationWarning: the theme (data-theme) is applied to <html> on the
  // client after we read the saved preference, so the attribute legitimately
  // differs between the server render and the first client render.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${courierPrime.variable} ${montserrat.variable} ${jost.variable}`}>
        <StorageBanner />
        <ToastHost />
        {children}
      </body>
    </html>
  );
}
