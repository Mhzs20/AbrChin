"use client";

import {
  ArrowLeft,
  Boxes,
  Braces,
  Check,
  CircleHelp,
  Compass,
  FileText,
  Globe2,
  HeartHandshake,
  Layers3,
  LineChart,
  MapPin,
  MoveRight,
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
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export type CompassAnswers = Partial<Record<"project" | "stage" | "management" | "priority" | "location", string>>;

type WizardOption = {
  value: string;
  label: string;
  icon: LucideIcon;
};

type WizardStep = {
  id: keyof CompassAnswers;
  kicker: string;
  question: string;
  hint: string;
  options: WizardOption[];
};

const steps: WizardStep[] = [
  {
    id: "project",
    kicker: "اول خود پروژه",
    question: "چی داری می‌سازی؟",
    hint: "اسم تکنولوژی مهم نیست؛ کاری که باید انجام بده مهمه.",
    options: [
      { value: "site", label: "سایت و محتوا", icon: FileText },
      { value: "commerce", label: "فروش آنلاین", icon: ShoppingBag },
      { value: "product", label: "اپ و محصول", icon: Boxes },
      { value: "api", label: "API و سرویس", icon: Braces },
      { value: "migration", label: "انتقال سرویس", icon: RefreshCw },
      { value: "unsure", label: "هنوز مطمئن نیستم", icon: CircleHelp },
    ],
  },
  {
    id: "stage",
    kicker: "جای فعلی تو",
    question: "الان کجای کاری؟",
    hint: "از اندازه‌ی درست شروع می‌کنیم؛ نه کمتر، نه بیشتر.",
    options: [
      { value: "building", label: "دارم می‌سازمش", icon: Wrench },
      { value: "launch", label: "آماده‌ی شروعه", icon: Rocket },
      { value: "active", label: "کاربر فعال دارم", icon: UsersRound },
      { value: "growing", label: "سریع در حال رشدم", icon: LineChart },
    ],
  },
  {
    id: "management",
    kicker: "میزان همراهی",
    question: "چقدرش رو بسپری به ما؟",
    hint: "کنترل کامل یا خیال راحت؛ هر دو مسیر شفاف‌اند.",
    options: [
      { value: "raw", label: "فقط زیرساخت خام", icon: Server },
      { value: "ready", label: "برام آماده‌اش کن", icon: PackageCheck },
      { value: "managed", label: "مدیریتش هم با شما", icon: HeartHandshake },
    ],
  },
  {
    id: "priority",
    kicker: "اولویت اصلی",
    question: "چی برات مهم‌تره؟",
    hint: "مهم‌ترین اولویت رو انتخاب کن؛ بقیه رو متعادل می‌کنیم.",
    options: [
      { value: "economy", label: "شروع اقتصادی", icon: WalletCards },
      { value: "speed", label: "سرعت بیشتر", icon: Zap },
      { value: "stability", label: "پایداری بیشتر", icon: ShieldCheck },
      { value: "growth", label: "آماده‌ی رشد", icon: LineChart },
    ],
  },
  {
    id: "location",
    kicker: "نزدیک کاربرها",
    question: "بیشتر کاربرهات کجان؟",
    hint: "موقعیت درست، تجربه‌ی سریع‌تری می‌سازه.",
    options: [
      { value: "iran", label: "ایران", icon: MapPin },
      { value: "europe", label: "اروپا", icon: Globe2 },
      { value: "both", label: "ایران و اروپا", icon: Layers3 },
      { value: "unsure", label: "نمی‌دونم", icon: Compass },
    ],
  },
];

const projectNames: Record<string, string> = {
  site: "سایت و محتوا",
  commerce: "فروش آنلاین",
  product: "اپ و محصول",
  api: "API و سرویس",
  migration: "انتقال سرویس",
  unsure: "شروع منعطف",
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
  unsure: "بعد از بررسی",
};

function firstOpenStep(answers: CompassAnswers) {
  const index = steps.findIndex((step) => !answers[step.id]);
  return index === -1 ? steps.length - 1 : index;
}

function buildResult(answers: CompassAnswers) {
  const busy = answers.stage === "active" || answers.stage === "growing";
  const growthFirst = answers.priority === "growth" || answers.priority === "stability";
  const application = answers.project === "product" || answers.project === "api";
  const commerce = answers.project === "commerce";

  let cpu = application || commerce ? 4 : 2;
  let ram = application || commerce ? 8 : 4;
  let storage = commerce ? 140 : 100;

  if (busy || growthFirst) {
    cpu = 8;
    ram = 16;
    storage = commerce ? 240 : 180;
  }

  if (answers.priority === "economy" && !busy) {
    cpu = 2;
    ram = application ? 8 : 4;
    storage = 80;
  }

  return {
    project: projectNames[answers.project ?? ""] ?? "پروژه‌ی تو",
    management: managementNames[answers.management ?? ""] ?? "آماده‌به‌کار",
    location: locationNames[answers.location ?? ""] ?? "بعد از بررسی",
    cpu: `${cpu} vCPU`,
    ram: `${ram} GB`,
    storage: `${storage} GB`,
    scale: busy || growthFirst ? "فضای رشد رزروشده" : "ارتقای مرحله‌ای",
  };
}

export function CompassWizard({ initialAnswers = {} }: { initialAnswers?: CompassAnswers }) {
  const [answers, setAnswers] = useState<CompassAnswers>(initialAnswers);
  const [stepIndex, setStepIndex] = useState(() => firstOpenStep(initialAnswers));
  const [showResult, setShowResult] = useState(() => steps.every((step) => Boolean(initialAnswers[step.id])));

  const step = steps[stepIndex];
  const selected = answers[step.id];
  const result = useMemo(() => buildResult(answers), [answers]);

  const choose = (value: string) => {
    setAnswers((current) => ({ ...current, [step.id]: value }));
  };

  const next = () => {
    if (!selected) return;
    if (stepIndex === steps.length - 1) {
      setShowResult(true);
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const back = () => {
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const restart = () => {
    setAnswers({});
    setStepIndex(0);
    setShowResult(false);
  };

  if (showResult) {
    return (
      <section className="compass-result page-view" aria-labelledby="result-title">
        <div className="result-copy">
          <div className="eyebrow eyebrow-success"><Check size={15} aria-hidden="true" /> پیشنهاد اولیه آماده‌ست</div>
          <h1 id="result-title">شروع منطقی برای {result.project}</h1>
          <p>منابع نهایی و قیمت قبل از خرید با وضعیت واقعی پروژه چک می‌شن.</p>

          <div className="result-actions">
            <a
              className="button button-primary button-large"
              href="mailto:hello@abrchin.ir?subject=%D8%A8%D8%B1%D8%B1%D8%B3%DB%8C%20%D9%86%D9%87%D8%A7%DB%8C%DB%8C%20%D9%BE%DB%8C%D8%B4%D9%86%D9%87%D8%A7%D8%AF%20%D8%A7%D8%A8%D8%B1%DA%86%DB%8C%D9%86"
            >
              قیمت و راه‌اندازی
              <ArrowLeft size={19} aria-hidden="true" />
            </a>
            <button className="button button-quiet button-large" type="button" onClick={restart}>
              <RefreshCw size={17} aria-hidden="true" />
              از اول
            </button>
          </div>
        </div>

        <article className="result-card">
          <div className="result-card-head">
            <div>
              <span>پیشنهاد ابرچین</span>
              <h2>{result.project} · {result.management}</h2>
            </div>
            <span className="result-badge"><Sparkles size={20} aria-hidden="true" /></span>
          </div>

          <div className="resource-grid" dir="ltr">
            <div><span>CPU</span><strong>{result.cpu}</strong></div>
            <div><span>RAM</span><strong>{result.ram}</strong></div>
            <div><span>NVMe</span><strong>{result.storage}</strong></div>
          </div>

          <div className="result-details">
            <div><MapPin size={18} aria-hidden="true" /><span>موقعیت</span><strong>{result.location}</strong></div>
            <div><HeartHandshake size={18} aria-hidden="true" /><span>همراهی</span><strong>{result.management}</strong></div>
            <div><LineChart size={18} aria-hidden="true" /><span>رشد</span><strong>{result.scale}</strong></div>
          </div>

          <div className="result-note">
            <Check size={16} aria-hidden="true" />
            نوع سرور و ارائه‌دهنده بعد از بررسی نهایی مشخص می‌شه.
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="compass-page page-view" aria-labelledby="compass-title">
      <div className="wizard-main">
        <div className="wizard-heading">
          <div>
            <div className="eyebrow"><Compass size={15} aria-hidden="true" /> قطب‌نمای ابرچین</div>
            <p className="wizard-kicker">{step.kicker}</p>
            <h1 id="compass-title">{step.question}</h1>
            <p>{step.hint}</p>
          </div>
          <div className="step-number" aria-label={`مرحله ${stepIndex + 1} از ${steps.length}`}>
            <strong>{toPersianDigits(stepIndex + 1)}</strong>
            <span>از {toPersianDigits(steps.length)}</span>
          </div>
        </div>

        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>

        <div className={`wizard-options options-${step.options.length}`}>
          {step.options.map((option) => {
            const Icon = option.icon;
            const active = selected === option.value;
            return (
              <button
                key={option.value}
                className={active ? "selected" : ""}
                type="button"
                aria-pressed={active}
                onClick={() => choose(option.value)}
              >
                <span className="wizard-option-icon"><Icon size={23} aria-hidden="true" /></span>
                <strong>{option.label}</strong>
                <span className="wizard-check">{active && <Check size={14} aria-hidden="true" />}</span>
              </button>
            );
          })}
        </div>

        <div className="wizard-footer">
          {stepIndex === 0 ? (
            <Link className="wizard-back" href="/"><MoveRight size={17} aria-hidden="true" /> خانه</Link>
          ) : (
            <button className="wizard-back" type="button" onClick={back}><MoveRight size={17} aria-hidden="true" /> مرحله قبل</button>
          )}
          <button className="button button-primary wizard-next" type="button" disabled={!selected} onClick={next}>
            {stepIndex === steps.length - 1 ? "دیدن پیشنهاد" : "ادامه"}
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <aside className="wizard-summary" aria-label="خلاصه انتخاب‌ها">
        <div className="summary-cloud" aria-hidden="true">
          <span className="cloud-ring ring-one" />
          <span className="cloud-ring ring-two" />
          <span className="summary-symbol"><Store size={26} /></span>
        </div>
        <span className="summary-label">تا اینجا</span>
        <h2>{answers.project ? projectNames[answers.project] : "پروژه‌ی تو"}</h2>
        <div className="summary-list">
          <span><small>مرحله</small><strong>{answers.stage ? "مشخص شد" : "—"}</strong></span>
          <span><small>همراهی</small><strong>{answers.management ? managementNames[answers.management] : "—"}</strong></span>
          <span><small>اولویت</small><strong>{answers.priority ? "مشخص شد" : "—"}</strong></span>
        </div>
        <p>نوع زیرساخت، خروجی این مسیر است؛ لازم نیست از قبل انتخابش کنی.</p>
      </aside>
    </section>
  );
}

function toPersianDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
