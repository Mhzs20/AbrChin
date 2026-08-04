import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "راهکار فوری | ابرچین",
  description:
    "مسیر سرور آماده در راهکار فوری ادغام شده است.",
  alternates: { canonical: "/cloud-servers" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function ReadyServersPage() {
  redirect("/cloud-servers");
}
