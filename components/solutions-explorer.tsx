"use client";

import {
  ArrowLeft,
  Boxes,
  Check,
  RefreshCw,
  ShoppingBag,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Solution = {
  id: string;
  title: string;
  short: string;
  promise: string;
  icon: LucideIcon;
  support: string;
  bestFor: string[];
  includes: string[];
};

const solutions: Solution[] = [
  {
    id: "site",
    title: "سایت و محتوا",
    short: "سریع بالا بیا و راحت منتشر کن.",
    promise: "برای سایت‌های معرفی و محتوایی که باید سریع، امن و بی‌دردسر شروع شوند.",
    icon: Store,
    support: "آماده‌به‌کار",
    bestFor: ["سایت شرکتی", "مجله و محتوا", "پروژه‌ی تازه"],
    includes: ["راه‌اندازی اولیه", "امن‌سازی پایه", "مسیر ارتقای روشن"],
  },
  {
    id: "commerce",
    title: "فروش آنلاین",
    short: "برای فروشگاه و روزهای شلوغ.",
    promise: "برای فروشگاهی که سرعت خرید و پایداری زمان کمپین برایش مهم است.",
    icon: ShoppingBag,
    support: "مدیریت‌شده",
    bestFor: ["فروشگاه تازه", "کمپین فروش", "فروشگاه در حال رشد"],
    includes: ["چینش مناسب فروش", "بکاپ و پایش", "آمادگی برای ترافیک"],
  },
  {
    id: "product",
    title: "اپ و محصول",
    short: "برای MVP، API و SaaS.",
    promise: "از نسخه‌ی اول شروع کن و برای کاربرهای بعدی هم جا داشته باش.",
    icon: Boxes,
    support: "خام یا آماده‌به‌کار",
    bestFor: ["MVP و بتا", "اپ و API", "محصول SaaS"],
    includes: ["محیط استقرار", "دسترسی کامل", "ارتقای مرحله‌ای"],
  },
  {
    id: "migration",
    title: "انتقال و رشد",
    short: "وقتی سرویس فعلی کم آورده.",
    promise: "سرویس را با برنامه جابه‌جا می‌کنیم و برای مرحله‌ی بعد آماده‌اش می‌کنیم.",
    icon: RefreshCw,
    support: "مدیریت‌شده",
    bestFor: ["کندی و قطعی", "تغییر ارائه‌دهنده", "رشد ناگهانی"],
    includes: ["برنامه‌ی انتقال", "تست قبل از سوییچ", "همراهی تا پایداری"],
  },
];

export function SolutionsExplorer() {
  const [selectedId, setSelectedId] = useState("site");
  const selected = solutions.find((item) => item.id === selectedId) ?? solutions[0];
  const SelectedIcon = selected.icon;

  return (
    <div className="solutions-workspace">
      <div className="solution-tabs" role="tablist" aria-label="راهکارهای ابرچین">
        {solutions.map((solution) => {
          const Icon = solution.icon;
          const active = selected.id === solution.id;
          return (
            <button
              key={solution.id}
              id={`solution-tab-${solution.id}`}
              className={active ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="solution-panel"
              onClick={() => setSelectedId(solution.id)}
            >
              <span><Icon size={20} aria-hidden="true" /></span>
              <span><strong>{solution.title}</strong><small>{solution.short}</small></span>
            </button>
          );
        })}
      </div>

      <article
        className="solution-panel"
        id="solution-panel"
        role="tabpanel"
        aria-labelledby={`solution-tab-${selected.id}`}
      >
        <div className="solution-panel-top">
          <span className="solution-big-icon"><SelectedIcon size={29} aria-hidden="true" /></span>
          <span className="support-pill">سطح پیشنهادی: {selected.support}</span>
        </div>

        <h2>{selected.title}</h2>
        <p>{selected.promise}</p>

        <div className="solution-columns">
          <div>
            <small>مناسب برای</small>
            {selected.bestFor.map((item) => <span key={item}><Check size={15} aria-hidden="true" />{item}</span>)}
          </div>
          <div>
            <small>تحویل می‌گیری</small>
            {selected.includes.map((item) => <span key={item}><Check size={15} aria-hidden="true" />{item}</span>)}
          </div>
        </div>

        <div className="solution-panel-footer">
          <p>نوع بستر بعد از بررسی نیاز مشخص می‌شه.</p>
          <Link className="button button-primary" href={`/compass?project=${selected.id}`}>
            پیشنهاد این راهکار
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </div>
  );
}
