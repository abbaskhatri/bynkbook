import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "BynkBook",
    template: "%s | BynkBook",
  },
  description: "Modern bookkeeping and reconciliation for serious businesses.",
  applicationName: "BynkBook",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}