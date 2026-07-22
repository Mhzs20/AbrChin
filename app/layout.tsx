import type { Metadata, Viewport } from "next";
import "./globals.css";

import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://abrchin.ir"),
  title: {
    default: "ابرچین | زیرساخت ساده، آماده‌ی رشد",
    template: "%s",
  },
  description:
    "بگو چی می‌سازی؛ ابرچین زیرساخت مناسب پروژه‌ات رو پیشنهاد می‌ده، راه می‌اندازه و اگر بخوای مدیریتش هم می‌کنه.",
  applicationName: "ابرچین",
  keywords: ["ابرچین", "زیرساخت ابری", "سرور مجازی", "زیرساخت مدیریت‌شده", "هاست وردپرس"],
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "ابرچین | زیرساخت ساده، آماده‌ی رشد",
    description: "بگو چی می‌سازی؛ زیرساختش رو ابرچین می‌چینه.",
    siteName: "ابرچین",
    url: "https://abrchin.ir",
    locale: "fa_IR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ابرچین | زیرساخت ساده، آماده‌ی رشد",
    description: "بگو چی می‌سازی؛ زیرساختش رو ابرچین می‌چینه.",
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
