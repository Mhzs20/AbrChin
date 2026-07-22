"use client";

import { ArrowLeft, Check, HeartHandshake, PackageCheck, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type SupportLevel = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  icon: LucideIcon;
  items: string[];
  recommended?: boolean;
};

const levels: SupportLevel[] = [
  {
    id: "raw",
    kicker: "کنترل دست خودت",
    title: "خام",
    description: "زیرساخت رو تحویل می‌گیری و ادامه‌ی فنی با تیم خودته.",
    icon: Server,
    items: ["دسترسی کامل", "انتخاب منابع", "مناسب تیم فنی"],
  },
  {
    id: "ready",
    kicker: "سریع شروع کن",
    title: "آماده‌به‌کار",
    description: "محیط رو امن و آماده می‌کنیم؛ تو مستقیم پروژه رو بالا میاری.",
    icon: PackageCheck,
    items: ["تنظیم اولیه", "امن‌سازی پایه", "آماده‌ی استقرار"],
    recommended: true,
  },
  {
    id: "managed",
    kicker: "خیالت راحت",
    title: "مدیریت‌شده",
    description: "نگهداری زیرساخت رو می‌سپری به ابرچین و روی کارت می‌مونی.",
    icon: HeartHandshake,
    items: ["پایش و بکاپ", "نگهداری مداوم", "همراهی وقت رشد"],
  },
];

export function SupportSelector() {
  const [selectedId, setSelectedId] = useState("ready");
  const selected = levels.find((level) => level.id === selectedId) ?? levels[1];

  return (
    <div className="support-workspace">
      <div className="support-levels" aria-label="سطح‌های همراهی ابرچین">
        {levels.map((level) => {
          const Icon = level.icon;
          const active = selectedId === level.id;
          return (
            <button
              key={level.id}
              className={active ? "active" : ""}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedId(level.id)}
            >
              {level.recommended && <span className="popular-badge">پیشنهاد شروع</span>}
              <span className="level-icon"><Icon size={25} aria-hidden="true" /></span>
              <small>{level.kicker}</small>
              <h2>{level.title}</h2>
              <p>{level.description}</p>
              <span className="level-items">
                {level.items.map((item) => <span key={item}><Check size={14} aria-hidden="true" />{item}</span>)}
              </span>
              <span className="level-select">{active ? "انتخاب شد" : "انتخاب"}</span>
            </button>
          );
        })}
      </div>

      <div className="support-choice">
        <div>
          <span>انتخاب فعلی</span>
          <strong>{selected.title}</strong>
          <p>توی قطب‌نما می‌تونی بقیه نیازها رو هم مشخص کنی.</p>
        </div>
        <Link className="button button-primary" href={`/compass?management=${selected.id}`}>
          ادامه با این سطح
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
