import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const themeBootstrapScript = `
(function() {
  try {
    var storageKey = "bynkbook-theme";
    var storedPreference = window.localStorage.getItem(storageKey);
    var preference = storedPreference === "dark" || storedPreference === "system" || storedPreference === "light"
      ? storedPreference
      : "light";
    var shouldUseDark = preference === "dark" ||
      (preference === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  } catch (error) {
    document.documentElement.classList.remove("dark");
  }
})();
`;

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-[200] -translate-y-20 rounded-md bg-bb-surface-elevated px-4 py-3 font-semibold text-bb-text shadow-lg transition-transform focus:translate-y-0"
        >
          Skip to main content
        </a>
        <div id="main-content" tabIndex={-1}>
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
