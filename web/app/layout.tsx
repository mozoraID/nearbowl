import { Shell } from "@/components/Shell";
import type { Metadata, Viewport } from "next";
import { Figtree, Outfit } from "next/font/google";
import "./globals.css";

const display = Outfit({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"] });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "NearBowl", template: "%s · NearBowl" },
  description: "A USDC meme-coin launchpad on NEAR. Feed a coin or it dies, then holders share what is left.",
};

export const viewport: Viewport = {
  themeColor: "#101418",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
