import type { Metadata, Viewport } from "next";
import { Courier_Prime } from "next/font/google";
import "./globals.css";

// Courier Prime — a free, screen-friendly Courier (the spec's preferred font).
// Exposed as a CSS variable so the editor can switch fonts at runtime.
const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-courier-prime",
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
      <body className={courierPrime.variable}>{children}</body>
    </html>
  );
}
