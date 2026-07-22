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
        <h1 id="solutions-title">راهکار آماده، برای نیاز واقعی.</h1>
        <p>کارت رو انتخاب کن؛ جزئیات فنی رو ما می‌چینیم.</p>
      </header>
      <SolutionsExplorer />
    </section>
  );
}
