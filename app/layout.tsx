import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://abrchin.ir"),
  title: "ابرچین | زیرساخت ساده، آماده‌ی رشد",
  description:
    "نیازت رو بگو؛ ابرچین زیرساخت مناسب پروژه‌ات رو پیشنهاد می‌ده، راه می‌اندازه و برای رشد کنارت می‌مونه.",
  applicationName: "ابرچین",
  openGraph: {
    title: "ابرچین | زیرساخت ساده، آماده‌ی رشد",
    description: "نیازت رو بگو؛ زیرساختش رو ابرچین می‌چینه.",
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f7ff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
