"use client";

import {
  ArrowLeft,
  ArrowUpLeft,
  Boxes,
  Braces,
  Check,
  ChevronLeft,
  CircleHelp,
  Cloud,
  Code2,
  Compass,
  FileText,
  Gauge,
  Globe2,
  HandHeart,
  Headphones,
  HeartHandshake,
  Home,
  Layers3,
  LifeBuoy,
  LineChart,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircleMore,
  MoveRight,
  Newspaper,
  PackageCheck,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  UsersRound,
  WalletCards,
  WandSparkles,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

type ViewId = "home" | "compass" | "solutions" | "support" | "about" | "help";
type Answers = Record<string, string>;

type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { id: "home", label: "خانه", icon: Home },
  { id: "compass", label: "قطب‌نما", icon: Compass },
  { id: "solutions", label: "راهکارها", icon: Layers3 },
  { id: "support", label: "همراهی", icon: HeartHandshake },
  { id: "about", label: "ابرچین", icon: Cloud },
  { id: "help", label: "کمک", icon: CircleHelp },
];

const solutionItems = [
  {
    id: "content",
    title: "سایت و محتوا",
    short: "برای معرفی، مجله و سایت‌های پرمحتوا",
    icon: Newspaper,
    color: "blue",
    lead: "سریع بالا بیا، راحت محتوا منتشر کن و درگیر نگهداری روزمره نشو.",
    goodFor: ["سایت شرکتی و شخصی", "مجله و پلتفرم محتوا", "وردپرس پرترافیک"],
    delivery: ["راه‌اندازی و بهینه‌سازی اولیه", "امنیت و بکاپ منظم", "مسیر رشد بدون جابه‌جایی عجولانه"],
  },
  {
    id: "commerce",
    title: "فروش آنلاین",
    short: "برای فروشگاه، کمپین و روزهای شلوغ",
    icon: ShoppingBag,
    color: "coral",
    lead: "فروشگاهت وقت کمپین جا نزنه و تجربه خرید، سریع و قابل اعتماد بمونه.",
    goodFor: ["فروشگاه تازه‌راه‌افتاده", "کمپین‌های فروش", "فروشگاه در حال مهاجرت"],
    delivery: ["زیرساخت متناسب با سفارش‌ها", "کش و بهینه‌سازی سرعت", "پایش و آماده‌سازی برای پیک ترافیک"],
  },
  {
    id: "product",
    title: "محصول و SaaS",
    short: "برای اپ، API و محصول نرم‌افزاری",
    icon: Braces,
    color: "violet",
    lead: "از نسخه اول محصول شروع کن و بدون بازسازی دردناک، برای کاربرهای بعدی جا داشته باش.",
    goodFor: ["MVP و نسخه بتا", "API و سرویس بک‌اند", "محصول SaaS"],
    delivery: ["محیط آماده استقرار", "تفکیک اپ و داده در زمان درست", "نقشه ارتقا متناسب با رشد محصول"],
  },
  {
    id: "growth",
    title: "رشد و ترافیک",
    short: "وقتی زیرساخت فعلی دیگه جواب نمی‌ده",
    icon: LineChart,
    color: "green",
    lead: "گلوگاه رو پیدا می‌کنیم، منابع رو هدفمند بالا می‌بریم و جلوی هزینه اضافه رو می‌گیریم.",
    goodFor: ["رشد ناگهانی کاربر", "کندی و قطعی‌های تکراری", "کمپین و رویداد"],
    delivery: ["بررسی گلوگاه واقعی", "چینش مقیاس‌پذیر", "پایش قبل و بعد از تغییر"],
  },
  {
    id: "migration",
    title: "انتقال",
    short: "جابه‌جایی امن، با کمترین دردسر",
    icon: MoveRight,
    color: "navy",
    lead: "سرویس فعلی رو بررسی می‌کنیم و با برنامه‌ای روشن، به بستر مناسب‌تر منتقلش می‌کنیم.",
    goodFor: ["مهاجرت از هاست یا سرور", "تغییر ارائه‌دهنده", "ارتقای معماری"],
    delivery: ["برنامه انتقال و بازگشت", "تست قبل از سوییچ", "همراهی تا پایدار شدن سرویس"],
  },
] as const;

const supportLevels = [
  {
    id: "raw",
    eyebrow: "کنترل دست خودت",
    title: "زیرساخت خام",
    icon: Server,
    description: "منابع مناسب رو می‌گیری و ادامه مسیر فنی کاملاً با تیم خودته.",
    bullets: ["انتخاب و تحویل زیرساخت", "دسترسی کامل", "مناسب تیم فنی مستقل"],
  },
  {
    id: "ready",
    eyebrow: "شروع بی‌دردسر",
    title: "آماده‌به‌کار",
    icon: PackageCheck,
    description: "محیط رو امن و آماده می‌کنیم تا مستقیم سراغ راه‌اندازی پروژه بری.",
    bullets: ["نصب و تنظیم اولیه", "امن‌سازی پایه", "آماده برای استقرار"],
    recommended: true,
  },
  {
    id: "managed",
    eyebrow: "خیالت با ما",
    title: "مدیریت‌شده",
    icon: HandHeart,
    description: "پایش، بکاپ و نگهداری زیرساخت رو می‌سپری به تیم ابرچین.",
    bullets: ["پایش مداوم", "بکاپ و به‌روزرسانی", "همراهی موقع تغییر و رشد"],
  },
] as const;

const compassSteps = [
  {
    id: "project",
    eyebrow: "اول خود پروژه",
    question: "چی می‌خوای راه بندازی؟",
    hint: "لازم نیست اسم تکنولوژی یا نوع سرور رو بدونی.",
    options: [
      { value: "content", label: "سایت یا مجله", icon: FileText },
      { value: "commerce", label: "فروشگاه آنلاین", icon: Store },
      { value: "product", label: "محصول یا اپ", icon: Boxes },
      { value: "api", label: "API یا سرویس", icon: Code2 },
      { value: "development", label: "محیط توسعه", icon: Wrench },
      { value: "unsure", label: "هنوز مطمئن نیستم", icon: Sparkles },
    ],
  },
  {
    id: "stage",
    eyebrow: "جای فعلی توی مسیر",
    question: "الان کجای کاری؟",
    hint: "این جواب کمک می‌کنه نه کمتر از نیازت بگیری، نه بیشتر.",
    options: [
      { value: "building", label: "دارم می‌سازمش", icon: Wrench },
      { value: "launch", label: "آماده‌ی شروعه", icon: Rocket },
      { value: "active", label: "کاربر فعال دارم", icon: UsersRound },
      { value: "growing", label: "سریع دارم رشد می‌کنم", icon: LineChart },
      { value: "migration", label: "می‌خوام منتقلش کنم", icon: RefreshCw },
    ],
  },
  {
    id: "management",
    eyebrow: "میزان همراهی",
    question: "چقدر از کار فنی رو بسپری به ما؟",
    hint: "هر سه انتخاب شفاف‌اند؛ فقط مدل همراهی فرق می‌کنه.",
    options: [
      { value: "raw", label: "فقط زیرساخت", icon: Server },
      { value: "ready", label: "برام آماده‌اش کن", icon: PackageCheck },
      { value: "managed", label: "مدیریتش هم با شما", icon: HeartHandshake },
    ],
  },
  {
    id: "priority",
    eyebrow: "چیزی که مهم‌تره",
    question: "اولویت اصلیت چیه؟",
    hint: "بین هزینه، سرعت و خیال راحت، مهم‌ترین رو انتخاب کن.",
    options: [
      { value: "economy", label: "شروع اقتصادی", icon: WalletCards },
      { value: "speed", label: "سرعت بیشتر", icon: Zap },
      { value: "stability", label: "پایداری بیشتر", icon: ShieldCheck },
      { value: "growth", label: "آماده‌ی رشد", icon: LineChart },
      { value: "support", label: "همراهی نزدیک", icon: Headphones },
    ],
  },
  {
    id: "location",
    eyebrow: "نزدیک‌تر به کاربرها",
    question: "بیشتر کاربرهات کجان؟",
    hint: "مکان درست، روی سرعت و تجربه کاربر اثر مستقیم داره.",
    options: [
      { value: "iran", label: "ایران", icon: MapPin },
      { value: "europe", label: "اروپا", icon: Globe2 },
      { value: "both", label: "هر دو", icon: Layers3 },
      { value: "unsure", label: "نمی‌دونم", icon: Compass },
    ],
  },
] as const;

const projectNames: Record<string, string> = {
  content: "سایت و محتوا",
  commerce: "فروش آنلاین",
  product: "محصول و اپ",
  api: "API و سرویس",
  development: "محیط توسعه",
  unsure: "شروع انعطاف‌پذیر",
};

const managementNames: Record<string, string> = {
  raw: "زیرساخت خام",
  ready: "آماده‌به‌کار",
  managed: "مدیریت‌شده",
};

const locationNames: Record<string, string> = {
  iran: "ایران",
  europe: "اروپا",
  both: "ایران + اروپا",
  unsure: "پس از بررسی",
};

export function AbrChinDashboard() {
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [toast, setToast] = useState("");

  const goTo = (id: ViewId) => {
    setActiveView(id);
    window.history.replaceState(null, "", "#" + id);
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  return (
    <div className="app-canvas">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="ambient ambient-three" aria-hidden="true" />

      <section className="site-shell" aria-label="وب‌سایت ابرچین">
        <Topbar goTo={goTo} notify={notify} />

        <main className="view-stage" id="main-content">
          <div className="view-enter" key={activeView}>
            {activeView === "home" && <HomeView goTo={goTo} />}
            {activeView === "compass" && <CompassView goTo={goTo} />}
            {activeView === "solutions" && <SolutionsView goTo={goTo} />}
            {activeView === "support" && <SupportView goTo={goTo} />}
            {activeView === "about" && <AboutView goTo={goTo} />}
            {activeView === "help" && <HelpView goTo={goTo} />}
          </div>
        </main>

        <Sidebar activeView={activeView} goTo={goTo} />
        <MobileNavigation activeView={activeView} goTo={goTo} />
      </section>

      <div className={"toast " + (toast ? "toast-visible" : "")} role="status" aria-live="polite">
        <Sparkles size={17} />
        <span>{toast}</span>
      </div>
    </div>
  );
}

function Topbar({
  goTo,
  notify,
}: {
  goTo: (id: ViewId) => void;
  notify: (message: string) => void;
}) {
  return (
    <header className="topbar">
      <button className="brand-button" onClick={() => goTo("home")} aria-label="رفتن به خانه">
        <Image src="/assets/abrchin-logo.svg" alt="ابرچین" className="brand-logo" width={148} height={52} priority />
      </button>

      <div className="topbar-tools">
        <div className="system-status" title="وضعیت سرویس‌های ابرچین">
          <span className="status-pulse" />
          <span>همه‌چیز روبه‌راهه</span>
        </div>
        <button className="ghost-button login-button" onClick={() => notify("پنل مشتری‌ها به‌زودی همین‌جا در دسترسه.")}>
          ورود
        </button>
        <button className="primary-button top-cta" onClick={() => goTo("compass")}>
          <span>پیدا کردن راهکار</span>
          <ArrowLeft size={18} />
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  activeView,
  goTo,
}: {
  activeView: ViewId;
  goTo: (id: ViewId) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-mark" aria-hidden="true">
        <Image src="/assets/abrchin-symbol.svg" alt="" width={38} height={32} />
      </div>
      <nav className="sidebar-nav" aria-label="منوی اصلی">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              className={"nav-button " + (active ? "active" : "")}
              aria-current={active ? "page" : undefined}
              onClick={() => goTo(item.id)}
              title={item.label}
            >
              <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="sidebar-help" onClick={() => goTo("help")} aria-label="کمک سریع">
        <LifeBuoy size={20} />
      </button>
    </aside>
  );
}

function MobileNavigation({
  activeView,
  goTo,
}: {
  activeView: ViewId;
  goTo: (id: ViewId) => void;
}) {
  return (
    <nav className="mobile-nav" aria-label="منوی موبایل">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.id;
        return (
          <button
            key={item.id}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            onClick={() => goTo(item.id)}
          >
            <Icon size={19} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function HomeView({ goTo }: { goTo: (id: ViewId) => void }) {
  return (
    <section className="home-view view-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="eyebrow-icon"><Sparkles size={15} /></span>
          زیرساخت، بدون سردرگمی
        </div>
        <h1 id="hero-title">
          زیرساخت ساده،
          <span> آماده‌ی رشد.</span>
        </h1>
        <p className="hero-lead">
          لازم نیست بین هاست، VPS و کلی مشخصات فنی بچرخی. بگو چی داری می‌سازی و کجای راهی؛ ما راهکار منطقی رو پیشنهاد می‌دیم، راهش می‌اندازیم و برای رشد بعدی هم کنارتیم.
        </p>

        <div className="hero-actions">
          <button className="primary-button large" onClick={() => goTo("compass")}>
            <Compass size={19} />
            <span>شروع قطب‌نما</span>
            <ArrowLeft size={18} />
          </button>
          <button className="secondary-button large" onClick={() => goTo("solutions")}>
            دیدن راهکارها
          </button>
        </div>

        <div className="trust-row" aria-label="مزیت‌های ابرچین">
          <div><Check size={15} /> پیشنهاد شفاف</div>
          <div><Check size={15} /> راه‌اندازی واقعی</div>
          <div><Check size={15} /> همراهی انسانی</div>
        </div>
      </div>

      <SkyComposer goTo={goTo} />

      <div className="home-metrics" aria-label="خلاصه مسیر ابرچین">
        <div>
          <strong>۵</strong>
          <span>سؤال تا پیشنهاد</span>
        </div>
        <div>
          <strong>۳</strong>
          <span>سطح همراهی</span>
        </div>
        <div>
          <strong>۱</strong>
          <span>مسیر روشن برای رشد</span>
        </div>
      </div>
    </section>
  );
}

function SkyComposer({ goTo }: { goTo: (id: ViewId) => void }) {
  return (
    <div className="sky-composer" aria-label="نمایش روند ساخت راهکار ابرچین">
      <div className="composer-grid" aria-hidden="true" />
      <div className="orbit orbit-a" aria-hidden="true" />
      <div className="orbit orbit-b" aria-hidden="true" />

      <div className="composer-topline">
        <span><span className="live-dot" /> پیشنهاد زنده</span>
        <span className="micro-tag">پروژه‌ی تو</span>
      </div>

      <div className="project-card">
        <span className="project-icon"><Store size={19} /></span>
        <span>
          <small>نیاز انتخاب‌شده</small>
          <strong>فروش آنلاین</strong>
        </span>
        <ChevronLeft size={18} />
      </div>

      <div className="composer-core">
        <span className="core-glow" />
        <Image src="/assets/abrchin-symbol.svg" alt="" width={92} height={73} />
        <span className="core-label">ابرچین می‌چیند</span>
      </div>

      <div className="signal signal-one"><Zap size={14} /> سرعت</div>
      <div className="signal signal-two"><ShieldCheck size={14} /> پایداری</div>
      <div className="signal signal-three"><LineChart size={14} /> رشد</div>

      <div className="stack-cards">
        <div className="stack-card">
          <span className="stack-icon blue"><Gauge size={18} /></span>
          <span><small>آماده برای</small><strong>شروع سریع</strong></span>
          <Check size={16} />
        </div>
        <div className="stack-card">
          <span className="stack-icon coral"><LockKeyhole size={18} /></span>
          <span><small>همراه با</small><strong>بکاپ و امنیت</strong></span>
          <Check size={16} />
        </div>
      </div>

      <button className="composer-action" onClick={() => goTo("compass")}>
        این پیشنهاد رو برای من بساز
        <ArrowUpLeft size={17} />
      </button>
    </div>
  );
}

function CompassView({ goTo }: { goTo: (id: ViewId) => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [showResult, setShowResult] = useState(false);

  const step = compassSteps[stepIndex];
  const selected = answers[step.id];

  const result = useMemo(() => buildCompassResult(answers), [answers]);

  const selectOption = (value: string) => {
    setAnswers((current) => ({ ...current, [step.id]: value }));
  };

  const next = () => {
    if (!selected) return;
    if (stepIndex === compassSteps.length - 1) {
      setShowResult(true);
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const back = () => {
    if (stepIndex === 0) {
      goTo("home");
      return;
    }
    setStepIndex((current) => current - 1);
  };

  const restart = () => {
    setAnswers({});
    setStepIndex(0);
    setShowResult(false);
  };

  if (showResult) {
    return (
      <section className="view-section compass-result" aria-labelledby="result-title">
        <div className="section-heading result-heading">
          <div className="eyebrow success"><Check size={15} /> پیشنهادت آماده‌ست</div>
          <h2 id="result-title">{result.title}</h2>
          <p>{result.summary}</p>
        </div>

        <div className="result-layout">
          <article className="recommended-card">
            <div className="recommendation-ribbon">پیشنهاد ابرچین</div>
            <div className="recommended-top">
              <div>
                <small>راهکار مناسب تو</small>
                <h3>{result.solution}</h3>
              </div>
              <span className="result-symbol"><Image src="/assets/abrchin-symbol.svg" alt="" width={55} height={47} /></span>
            </div>

            <div className="spec-grid" dir="ltr">
              <div><span>CPU</span><strong>{result.cpu}</strong></div>
              <div><span>RAM</span><strong>{result.ram}</strong></div>
              <div><span>NVMe</span><strong>{result.storage}</strong></div>
            </div>

            <div className="result-facts">
              <div><MapPin size={17} /><span>موقعیت</span><strong>{result.location}</strong></div>
              <div><HeartHandshake size={17} /><span>همراهی</span><strong>{result.management}</strong></div>
              <div><LineChart size={17} /><span>گام بعدی</span><strong>{result.nextStep}</strong></div>
            </div>

            <button className="primary-button result-cta" onClick={() => goTo("help")}>
              برای راه‌اندازی حرف بزنیم
              <ArrowLeft size={18} />
            </button>
          </article>

          <div className="alternative-column">
            <article className="alternative-card">
              <span className="alt-icon economy"><WalletCards size={19} /></span>
              <div><small>گزینه‌ی اقتصادی‌تر</small><strong>{result.economy}</strong></div>
              <ChevronLeft size={18} />
            </article>
            <article className="alternative-card">
              <span className="alt-icon growth"><LineChart size={19} /></span>
              <div><small>گزینه‌ی آماده‌ی رشد</small><strong>{result.growth}</strong></div>
              <ChevronLeft size={18} />
            </article>
            <button className="restart-button" onClick={restart}>
              <RefreshCw size={16} /> جواب‌ها رو از نو می‌دم
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view-section compass-view" aria-labelledby="compass-title">
      <div className="compass-header">
        <div>
          <div className="eyebrow"><Compass size={15} /> قطب‌نمای ابرچین</div>
          <h2 id="compass-title">{step.question}</h2>
          <p>{step.hint}</p>
        </div>
        <div className="step-count" aria-label={"مرحله " + (stepIndex + 1) + " از " + compassSteps.length}>
          <strong>{toPersianDigits(stepIndex + 1)}</strong>
          <span>/ {toPersianDigits(compassSteps.length)}</span>
        </div>
      </div>

      <div className="progress-track" aria-hidden="true">
        <span style={{ width: ((stepIndex + 1) / compassSteps.length) * 100 + "%" }} />
      </div>

      <div className="step-caption">{step.eyebrow}</div>

      <div className={"option-grid options-" + step.options.length}>
        {step.options.map((option) => {
          const Icon = option.icon;
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              className={"option-card " + (isSelected ? "selected" : "")}
              onClick={() => selectOption(option.value)}
              aria-pressed={isSelected}
            >
              <span className="option-icon"><Icon size={23} /></span>
              <span>{option.label}</span>
              <span className="selection-mark">{isSelected && <Check size={14} />}</span>
            </button>
          );
        })}
      </div>

      <div className="step-footer">
        <button className="text-button" onClick={back}>
          <MoveRight size={17} /> {stepIndex === 0 ? "برگشت به خانه" : "مرحله قبل"}
        </button>
        <button className="primary-button step-next" onClick={next} disabled={!selected}>
          {stepIndex === compassSteps.length - 1 ? "ساختن پیشنهاد من" : "بریم مرحله بعد"}
          <ArrowLeft size={18} />
        </button>
      </div>
    </section>
  );
}

function buildCompassResult(answers: Answers) {
  const busy = answers.stage === "active" || answers.stage === "growing";
  const early = answers.stage === "building";
  const solution = projectNames[answers.project] || "راهکار منعطف";
  const management = managementNames[answers.management] || "آماده‌به‌کار";
  const location = locationNames[answers.location] || "پس از بررسی";

  return {
    title: "یه مسیر روشن برای " + solution,
    summary: "بر اساس مرحله‌ی پروژه، اولویت و میزان همراهی که گفتی، این نقطه شروع منطقی‌تره؛ قبل از خرید هم یک‌بار با هم نهایی‌ش می‌کنیم.",
    solution: solution + " · " + management,
    cpu: busy ? "8 vCPU" : early ? "2 vCPU" : "4 vCPU",
    ram: busy ? "16 GB" : early ? "4 GB" : "8 GB",
    storage: busy ? "200 GB" : early ? "80 GB" : "120 GB",
    location,
    management,
    nextStep: busy ? "آماده‌ی مقیاس" : "ارتقای مرحله‌ای",
    economy: early ? "شروع سبک با منابع پایه" : "منابع کمتر، ارتقای سریع",
    growth: busy ? "تفکیک سرویس و داده" : "دو برابر ظرفیت شروع",
  };
}

function SolutionsView({ goTo }: { goTo: (id: ViewId) => void }) {
  const [selectedId, setSelectedId] = useState("content");
  const selected = solutionItems.find((item) => item.id === selectedId) ?? solutionItems[0];
  const SelectedIcon = selected.icon;

  return (
    <section className="view-section solutions-view" aria-labelledby="solutions-title">
      <div className="section-heading compact">
        <div className="eyebrow"><Layers3 size={15} /> راهکارها</div>
        <h2 id="solutions-title">از کاری که داری می‌سازی شروع کنیم.</h2>
        <p>اسم سرویس مهم نیست؛ نتیجه‌ای که می‌خوای مهمه.</p>
      </div>

      <div className="solutions-layout">
        <div className="solution-list" role="tablist" aria-label="راهکارهای ابرچین">
          {solutionItems.map((item) => {
            const Icon = item.icon;
            const active = selected.id === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                className={"solution-tab " + (active ? "active" : "")}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={"solution-tab-icon " + item.color}><Icon size={20} /></span>
                <span><strong>{item.title}</strong><small>{item.short}</small></span>
                <ChevronLeft size={18} />
              </button>
            );
          })}
        </div>

        <article className={"solution-detail detail-" + selected.color}>
          <div className="solution-detail-top">
            <span className={"detail-icon " + selected.color}><SelectedIcon size={28} /></span>
            <span className="detail-index">راهکار {toPersianDigits(solutionItems.findIndex((item) => item.id === selected.id) + 1)}</span>
          </div>
          <h3>{selected.title}</h3>
          <p>{selected.lead}</p>

          <div className="detail-columns">
            <div>
              <small>به‌درد چه کاری می‌خوره؟</small>
              {selected.goodFor.map((item) => <span key={item}><Check size={14} />{item}</span>)}
            </div>
            <div>
              <small>چی تحویل می‌گیری؟</small>
              {selected.delivery.map((item) => <span key={item}><Check size={14} />{item}</span>)}
            </div>
          </div>

          <button className="primary-button detail-cta" onClick={() => goTo("compass")}>
            راهکار مناسب من رو بساز
            <ArrowLeft size={18} />
          </button>
        </article>
      </div>
    </section>
  );
}

function SupportView({ goTo }: { goTo: (id: ViewId) => void }) {
  const [selected, setSelected] = useState("ready");

  return (
    <section className="view-section support-view" aria-labelledby="support-title">
      <div className="section-heading centered">
        <div className="eyebrow"><HeartHandshake size={15} /> سطح همراهی</div>
        <h2 id="support-title">هرچقدر که لازم داری، کنارتیم.</h2>
        <p>کنترل کامل، شروع آماده یا مدیریت مداوم؛ انتخاب با توئه.</p>
      </div>

      <div className="support-cards">
        {supportLevels.map((level) => {
          const Icon = level.icon;
          const active = selected === level.id;
          return (
            <button
              key={level.id}
              className={"support-card " + (active ? "active" : "")}
              onClick={() => setSelected(level.id)}
              aria-pressed={active}
            >
              {"recommended" in level && level.recommended && <span className="recommended-badge">پیشنهاد محبوب</span>}
              <span className="support-icon"><Icon size={25} /></span>
              <small>{level.eyebrow}</small>
              <h3>{level.title}</h3>
              <p>{level.description}</p>
              <span className="support-divider" />
              <span className="support-bullets">
                {level.bullets.map((bullet) => <span key={bullet}><Check size={14} />{bullet}</span>)}
              </span>
              <span className="support-select">
                {active ? "انتخاب شد" : "انتخاب این سطح"}
                {active ? <Check size={16} /> : <ChevronLeft size={16} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="support-footer">
        <p><MessageCircleMore size={17} /> بین دو سطح مرددی؟ توی قطب‌نما کمکت می‌کنیم انتخابش کنی.</p>
        <button className="secondary-button" onClick={() => goTo("compass")}>رفتن به قطب‌نما</button>
      </div>
    </section>
  );
}

function AboutView({ goTo }: { goTo: (id: ViewId) => void }) {
  const phases = [
    { number: "۰۱", label: "شروع ساده", text: "پیشنهاد و راه‌اندازی از بین زیرساخت‌های قابل اعتماد", active: true },
    { number: "۰۲", label: "کنترل یکپارچه", text: "پنل، پایش و مدیریت سرویس‌ها در یک تجربه‌ی واحد" },
    { number: "۰۳", label: "رشد هوشمند", text: "ارتقای خودکار و منابع اختصاصی ابرچین" },
    { number: "۰۴", label: "اکوسیستم ابری", text: "API، همکاری تیمی و راهکارهای گسترده‌تر" },
  ];

  return (
    <section className="view-section about-view" aria-labelledby="about-title">
      <div className="about-intro">
        <div className="about-symbol">
          <span className="about-orbit" />
          <Image src="/assets/abrchin-symbol.svg" alt="" width={120} height={101} />
        </div>
        <div>
          <div className="eyebrow"><Cloud size={15} /> قصه‌ی ابرچین</div>
          <h2 id="about-title">زیرساخت باید راه رو باز کنه، نه اینکه خودش مانع راه بشه.</h2>
          <p>
            ابرچین بین نیاز واقعی تو و دنیای پیچیده‌ی سرور می‌ایسته؛ سؤال‌های درست رو می‌پرسه، گزینه‌ها رو شفاف می‌کنه و چیزی می‌چینه که امروز به‌صرفه و فردا قابل رشد باشه.
          </p>
        </div>
      </div>

      <div className="brand-principles">
        <div><span><Compass size={20} /></span><strong>نیاز قبل از تکنولوژی</strong><small>اول می‌فهمیم چی می‌سازی.</small></div>
        <div><span><WandSparkles size={20} /></span><strong>سادگی بدون ساده‌انگاری</strong><small>پیچیدگی رو پشت تجربه نگه می‌داریم.</small></div>
        <div><span><LineChart size={20} /></span><strong>رشد بدون بن‌بست</strong><small>از همین امروز برای قدم بعد جا می‌ذاریم.</small></div>
      </div>

      <div className="roadmap-block">
        <div className="roadmap-heading">
          <div><small>مسیر ۲۴ ماهه</small><strong>ابرچین کجا می‌ره؟</strong></div>
          <button className="text-button" onClick={() => goTo("help")}>درباره مسیر حرف بزنیم <ArrowUpLeft size={16} /></button>
        </div>
        <div className="roadmap">
          {phases.map((phase) => (
            <div key={phase.number} className={phase.active ? "active" : ""}>
              <span className="roadmap-dot">{phase.number}</span>
              <strong>{phase.label}</strong>
              <small>{phase.text}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HelpView({ goTo }: { goTo: (id: ViewId) => void }) {
  const [openFaq, setOpenFaq] = useState(0);
  const faqs = [
    {
      question: "اگه ندونم چه منابعی لازم دارم چی؟",
      answer: "کاملاً طبیعیه. قطب‌نما از نوع پروژه، مرحله و اولویتت می‌پرسه و یک نقطه شروع منطقی پیشنهاد می‌ده؛ قبل از خرید هم با هم نهایی‌ش می‌کنیم.",
    },
    {
      question: "می‌تونم بعداً منابع رو بیشتر کنم؟",
      answer: "بله. اصل طراحی راهکارهای ابرچین همین رشد مرحله‌ایه؛ از اندازه منطقی شروع می‌کنی و وقتی نیاز واقعی بالا رفت ارتقا می‌دی.",
    },
    {
      question: "وردپرس یا VPS رو از کجا انتخاب کنم؟",
      answer: "لازم نیست از اول نوع سرویس رو انتخاب کنی. نیازت رو می‌گی و ابرچین در خروجی مشخص می‌کنه چه بستر و چه سطح مدیریتی مناسب‌تره.",
    },
  ];

  return (
    <section className="view-section help-view" aria-labelledby="help-title">
      <div className="help-main">
        <div className="section-heading compact">
          <div className="eyebrow"><LifeBuoy size={15} /> راهنما و ارتباط</div>
          <h2 id="help-title">هرجا گیر کردی، از همین‌جا صدامون کن.</h2>
          <p>برای انتخاب، انتقال یا راه‌اندازی پروژه کنارتیم.</p>
        </div>

        <div className="contact-actions">
          <button className="contact-action primary-contact" onClick={() => goTo("compass")}>
            <span className="contact-icon"><Compass size={23} /></span>
            <span><small>نمی‌دونی از کجا شروع کنی؟</small><strong>با قطب‌نما راهت رو پیدا کن</strong></span>
            <ArrowUpLeft size={19} />
          </button>
          <a className="contact-action" href="mailto:hello@abrchin.ir?subject=%D8%B4%D8%B1%D9%88%D8%B9%20%DA%AF%D9%81%D8%AA%E2%80%8C%D9%88%DA%AF%D9%88%20%D8%A8%D8%A7%20%D8%A7%D8%A8%D8%B1%DA%86%DB%8C%D9%86">
            <span className="contact-icon coral"><MessageCircleMore size={23} /></span>
            <span><small>پروژه‌ات آماده‌ست؟</small><strong>شروع یک گفت‌وگوی واقعی</strong></span>
            <ArrowUpLeft size={19} />
          </a>
          <a className="contact-action mini" href="mailto:hello@abrchin.ir">
            <Mail size={19} />
            <span><small>ایمیل مستقیم</small><strong dir="ltr">hello@abrchin.ir</strong></span>
          </a>
        </div>
      </div>

      <div className="faq-panel">
        <div className="faq-title"><span><CircleHelp size={19} /></span><strong>سؤال‌های پرتکرار</strong></div>
        <div className="faq-list">
          {faqs.map((faq, index) => {
            const open = openFaq === index;
            return (
              <button
                className={"faq-item " + (open ? "open" : "")}
                key={faq.question}
                onClick={() => setOpenFaq(open ? -1 : index)}
                aria-expanded={open}
              >
                <span className="faq-question">{faq.question}<ChevronLeft size={17} /></span>
                <span className="faq-answer">{faq.answer}</span>
              </button>
            );
          })}
        </div>
        <div className="response-note">
          <span className="live-dot" />
          <span><strong>پاسخ انسانی، نه رباتی</strong><small>معمولاً همون روز کاری برمی‌گردیم.</small></span>
        </div>
      </div>
    </section>
  );
}

function toPersianDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
