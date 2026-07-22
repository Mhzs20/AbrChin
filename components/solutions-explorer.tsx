import {
  ArrowLeft,
  Boxes,
  Check,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type Solution = {
  id: string;
  title: string;
  short: string;
  promise: string;
  icon: LucideIcon;
  support: string;
  parchin: string;
  bestFor: string[];
  includes: string[];
};

const solutions: Solution[] = [
  {
    id: "site",
    title: "سایت و محتوا",
    short: "سریع بالا بیا؛ ساده منتشر کن.",
    promise: "برای سایت‌هایی که باید سبک شروع بشن و با رشد محتوا راحت ارتقا پیدا کنن.",
    icon: Store,
    support: "آماده‌به‌کار",
    parchin: "امن‌سازی اولیه",
    bestFor: ["سایت شرکتی", "مجله و محتوا", "پروژه‌ی تازه"],
    includes: ["راه‌اندازی اولیه", "چینش قابل ارتقا", "انتقال ساده"],
  },
  {
    id: "commerce",
    title: "فروش آنلاین",
    short: "برای فروش و روزهای شلوغ.",
    promise: "برای فروشگاهی که سرعت خرید، بکاپ و پایداری زمان کمپین براش مهمه.",
    icon: ShoppingBag,
    support: "مدیریت‌شده",
    parchin: "پایش و بکاپ فعال",
    bestFor: ["فروشگاه تازه", "کمپین فروش", "فروشگاه روبه‌رشد"],
    includes: ["چینش مناسب فروش", "پایش مداوم", "آمادگی برای ترافیک"],
  },
  {
    id: "product",
    title: "اپ و محصول",
    short: "برای MVP، API و SaaS.",
    promise: "از نسخه‌ی اول شروع کن و برای کاربرها و سرویس‌های بعدی هم جا داشته باش.",
    icon: Boxes,
    support: "خام یا آماده‌به‌کار",
    parchin: "اختیاری یا فعال",
    bestFor: ["MVP و بتا", "اپ و API", "محصول SaaS"],
    includes: ["محیط استقرار", "دسترسی کامل", "ارتقای مرحله‌ای"],
  },
  {
    id: "migration",
    title: "انتقال و رشد",
    short: "وقتی سرویس فعلی کم آورده.",
    promise: "سرویس رو با برنامه جابه‌جا می‌کنیم و برای مرحله‌ی بعد آماده نگه می‌داریم.",
    icon: RefreshCw,
    support: "مدیریت‌شده",
    parchin: "پایش هنگام انتقال",
    bestFor: ["کندی و قطعی", "تغییر ارائه‌دهنده", "رشد ناگهانی"],
    includes: ["برنامه‌ی انتقال", "تست قبل از سوییچ", "همراهی تا پایداری"],
  },
];

export function SolutionsExplorer() {
  return (
    <div className="solutions-workspace">
      {solutions.map((solution) => {
        const Icon = solution.icon;
        return (
          <article className="solution-card" key={solution.id}>
            <div className="solution-card-head">
              <span className="solution-big-icon"><Icon size={27} aria-hidden="true" /></span>
              <span className="support-pill">{solution.support}</span>
            </div>

            <h2>{solution.title}</h2>
            <strong className="solution-short">{solution.short}</strong>
            <p>{solution.promise}</p>

            <div className="solution-facts">
              <span><Check size={15} aria-hidden="true" />{solution.bestFor[0]}</span>
              <span><Check size={15} aria-hidden="true" />{solution.includes[0]}</span>
              <span><ShieldCheck size={15} aria-hidden="true" />پرچین: {solution.parchin}</span>
            </div>

            <Link className="solution-link" href={`/compass?project=${solution.id}`}>
              پیشنهاد این راهکار
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
          </article>
        );
      })}
    </div>
  );
}
