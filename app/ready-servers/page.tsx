import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "سرور ابری | ابرچین",
  description:
    "مسیر سرور آماده در فهرست یکپارچه سرورهای ابری ابرچین قرار دارد.",
  alternates: { canonical: "/cloud-servers" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function ReadyServersPage() {
  redirect("/cloud-servers");
}
