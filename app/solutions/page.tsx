import { Layers3 } from "lucide-react";
import type { Metadata } from "next";

import { SolutionsExplorer } from "@/components/solutions-explorer";

export const metadata: Metadata = {
  title: "راهکارها | ابرچین",
  description: "راهکارهای زیرساختی ابرچین بر اساس نیاز پروژه، نه اسم تکنولوژی.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsPage() {
  return (
    <section className="solutions-page page-view" aria-labelledby="solutions-title">
      <header className="page-heading">
        <div className="eyebrow"><Layers3 size={15} aria-hidden="true" /> راهکارها</div>
        <h1 id="solutions-title">هر پروژه، چینش خودش رو می‌خواد.</h1>
        <p>از نیازت شروع کن؛ بستر و منابع مناسب رو ابرچین پیدا می‌کنه.</p>
      </header>
      <SolutionsExplorer />
    </section>
  );
}
