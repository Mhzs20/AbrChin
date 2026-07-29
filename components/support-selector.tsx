"use client";

import { ArrowLeft, Check, HeartHandshake, Server, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { ManagementKind } from "@/lib/recommendation/types";

type SupportLevel = {
  id: Exclude<ManagementKind, "unknown">;
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
    items: ["دسترسی کامل", "انتخاب منابع", "مدیریت و نگه‌داری با خودت"],
  },
  {
    id: "managed",
    kicker: "تحویل کنترل‌شده",
    title: "همراه ابرچین",
    description: "سرور بعد از کنترل وضعیت و با دسترسی یک‌بارمصرف تحویل می‌شه.",
    icon: HeartHandshake,
    items: ["پرچین پایه", "تحویل امن دسترسی", "پیگیری راه‌اندازی"],
    recommended: true,
  },
];

export function SupportSelector() {
  const [selectedId, setSelectedId] = useState<SupportLevel["id"]>("managed");
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
          <p>
            <ShieldCheck size={14} aria-hidden="true" />
            {selected.id === "managed"
              ? "پرچین پایه شامل تحویل کنترل‌شده است؛ پایش و بکاپ خودکار جزوش نیست."
              : "پایش، بکاپ و نگه‌داری کامل با خودت است."}
          </p>
        </div>
        <Link className="button button-primary" href={`/compass?management=${selected.id}`}>
          ساخت پیشنهاد با این سطح
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
