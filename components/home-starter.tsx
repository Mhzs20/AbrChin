"use client";

import { ArrowLeft, Boxes, CircleHelp, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const goals = [
  { id: "site", label: "سایت و محتوا", icon: Store },
  { id: "commerce", label: "فروش آنلاین", icon: ShoppingBag },
  { id: "product", label: "اپ و محصول", icon: Boxes },
  { id: "unsure", label: "هنوز مطمئن نیستم", icon: CircleHelp },
] as const;

export function HomeStarter() {
  const [selected, setSelected] = useState<string>("");

  return (
    <div className="starter-card">
      <div className="starter-heading">
        <span className="starter-step">شروع از نیاز</span>
        <span className="starter-time">کمتر از ۲ دقیقه</span>
      </div>

      <div>
        <p className="starter-kicker">چی داری می‌سازی؟</p>
        <h2>از نیازت شروع کنیم.</h2>
        <p className="starter-description">فنی بودن لازم نیست؛ چند سؤال کوتاه می‌پرسیم و نقطه‌ی شروع مناسب رو پیشنهاد می‌دیم.</p>
      </div>

      <div className="starter-options" aria-label="انتخاب نوع پروژه">
        {goals.map((goal) => {
          const Icon = goal.icon;
          const active = selected === goal.id;

          return (
            <button
              key={goal.id}
              className={active ? "selected" : ""}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(goal.id)}
            >
              <span><Icon size={21} aria-hidden="true" /></span>
              {goal.label}
            </button>
          );
        })}
      </div>

      <div className="starter-footer">
        <p aria-live="polite">
          {selected ? "خوبه؛ حالا پیشنهادت رو دقیق‌تر می‌کنیم." : "یکی رو انتخاب کن تا ادامه بدیم."}
        </p>
        {selected ? (
          <Link className="button button-primary" href={`/compass?project=${selected}`}>
            ادامه و ساخت پیشنهاد
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        ) : (
          <span className="button button-disabled" aria-disabled="true">
            ادامه
            <ArrowLeft size={18} aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="starter-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
