import type { Metadata, Viewport } from "next";
import "./globals.css";

import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://abrchin.ir"),
  title: {
    default: "ابرچین | زیرساختت رو سوار بر ابرها بساز",
    template: "%s",
  },
  description:
    "ابرچین ابرها را برای یک شروع ساده، ادامه امن با پرچین و رشد بدون بن‌بست می‌چیند.",
  applicationName: "ابرچین",
  keywords: ["ابرچین", "زیرساخت ابری", "سرور مجازی", "زیرساخت مدیریت‌شده", "هاست وردپرس"],
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "ابرچین | زیرساختت رو سوار بر ابرها بساز",
    description: "ساده شروع کن، با پرچین امن ادامه بده و بدون بن‌بست رشد کن.",
    siteName: "ابرچین",
    url: "https://abrchin.ir",
    locale: "fa_IR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ابرچین | زیرساختت رو سوار بر ابرها بساز",
    description: "ساده شروع کن، با پرچین امن ادامه بده و بدون بن‌بست رشد کن.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f7fd",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body><SiteShell>{children}</SiteShell></body>
    </html>
  );
}
