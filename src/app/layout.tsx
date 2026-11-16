import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "sonner";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: { default: "AUREX — Phone Replacement Parts & Components | Built for Performance", template: "%s | AUREX" },
  description: "Tested mobile phone replacement parts and electronic components — screens, batteries, charging ports, cameras and more. Fast delivery across Nigeria, retail and wholesale.",
  applicationName: "AUREX",
  openGraph: { type: "website", siteName: "AUREX", locale: "en_NG", title: "AUREX — Built for Performance", description: "Tested phone replacement parts and electronic components, delivered across Nigeria." },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#080808", colorScheme: "dark", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Toaster theme="dark" position="top-center" toastOptions={{ style: { background: "#181818", border: "1px solid #292929", color: "#fff" }, actionButtonStyle: { background: "#D6A64C", color: "#080808", fontWeight: 600 } }} />
      </body>
    </html>
  );
}
