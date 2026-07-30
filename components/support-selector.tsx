import { ArrowLeft, Check, HeartHandshake, ShieldCheck } from "lucide-react";
import Link from "next/link";

export function SupportSelector() {
  return (
    <div className="support-workspace">
      <article className="support-choice support-choice--single">
        <div>
          <span className="level-icon">
            <HeartHandshake size={25} aria-hidden="true" />
          </span>
          <span>سطح ثابت همه سرورهای ابری</span>
          <strong>همراه ابرچین</strong>
          <p>
            <ShieldCheck size={14} aria-hidden="true" />
            پرچین پایه شامل تحویل کنترل‌شده، دسترسی امن یک‌بارمصرف و پیگیری
            راه‌اندازی است.
          </p>
          <span className="level-items">
            <span><Check size={14} aria-hidden="true" /> بررسی سلامت اولیه</span>
            <span><Check size={14} aria-hidden="true" /> تنظیمات قفل‌شده Quote</span>
            <span><Check size={14} aria-hidden="true" /> بدون Provider Swap بعد از پرداخت</span>
          </span>
          <small>
            پایش، بکاپ و نگه‌داری روزمره تا زمان تعریف Line Item مستقل، بخشی از
            پرچین پایه نیستند.
          </small>
        </div>
        <Link className="button button-primary" href="/cloud-servers">
          دیدن سرورهای آماده
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </article>
    </div>
  );
}
