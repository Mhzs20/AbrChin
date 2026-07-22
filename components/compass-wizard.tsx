"use client";

import {
  ArrowLeft,
  Boxes,
  Braces,
  Check,
  CircleHelp,
  Clock3,
  Compass,
  Copy,
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

export type CompassAnswers = Partial<
  Record<"project" | "stage" | "scale" | "management" | "priority" | "location", string>
>;

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

type PlanProfile = {
  id: "lean" | "balanced" | "growth";
  title: string;
  description: string;
  cpu: number;
  ram: number;
  storage: number;
  recommended?: boolean;
};

const steps: WizardStep[] = [
  {
    id: "project",
    kicker: "اول خود پروژه",
    question: "چی داری می‌سازی؟",
    hint: "اسم تکنولوژی مهم نیست؛ کاری که قراره انجام بده مهمه.",
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
    id: "scale",
    kicker: "اندازه‌ی استفاده",
    question: "چقدر ازش استفاده می‌شه؟",
    hint: "یک تخمین ساده کافیه؛ لازم نیست عدد فنی بدونی.",
    options: [
      { value: "starting", label: "هنوز اول راهه", icon: Sparkles },
      { value: "light", label: "استفاده سبک", icon: Store },
      { value: "daily", label: "استفاده روزانه", icon: UsersRound },
      { value: "heavy", label: "پرترافیک یا حساس", icon: Zap },
      { value: "unsure", label: "نمی‌دونم", icon: CircleHelp },
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
    hint: "مهم‌ترین اولویت رو بگو؛ بقیه رو متعادل می‌کنیم.",
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

const cpuTiers = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const ramTiers = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

function nextTier(value: number, tiers: number[]) {
  return tiers.find((tier) => tier >= value) ?? Math.ceil(value / 16) * 16;
}

function buildResult(answers: CompassAnswers) {
  let cpu = 2;
  let ram = 4;
  let storage = 80;

  if (["commerce", "product", "api", "migration"].includes(answers.project ?? "")) {
    cpu = 4;
    ram = 8;
    storage = answers.project === "commerce" ? 140 : 110;
  }

  if (answers.stage === "active") {
    cpu += 2;
    ram += 4;
    storage += 40;
  }

  if (answers.stage === "growing") {
    cpu += 4;
    ram += 8;
    storage += 80;
  }

  if (answers.scale === "daily") {
    cpu += 2;
    ram += 4;
  }

  if (answers.scale === "heavy") {
    cpu += 4;
    ram += 8;
    storage += 80;
  }

  if (answers.priority === "speed") cpu += 2;
  if (answers.priority === "stability") ram += 4;
  if (answers.priority === "growth") {
    cpu += 2;
    ram += 4;
    storage += 40;
  }

  if (answers.priority === "economy" && answers.scale !== "heavy" && answers.stage !== "growing") {
    cpu = Math.min(cpu, 4);
    ram = Math.min(ram, 8);
  }

  cpu = nextTier(cpu, cpuTiers);
  ram = nextTier(ram, ramTiers);
  storage = Math.ceil(storage / 20) * 20;

  const profiles: PlanProfile[] = [
    {
      id: "lean",
      title: "شروع سبک",
      description: "برای شروع کم‌هزینه و ارتقای مرحله‌ای.",
      cpu: nextTier(cpu * 0.6, cpuTiers),
      ram: nextTier(ram * 0.6, ramTiers),
      storage: Math.max(60, Math.ceil(storage * 0.7 / 20) * 20),
    },
    {
      id: "balanced",
      title: "چینش پیشنهادی",
      description: "تعادل منطقی بین هزینه، پایداری و رشد.",
      cpu,
      ram,
      storage,
      recommended: true,
    },
    {
      id: "growth",
      title: "آماده‌ی رشد",
      description: "فضای بیشتر برای ترافیک و مرحله‌ی بعد.",
      cpu: nextTier(cpu * 1.5, cpuTiers),
      ram: nextTier(ram * 1.5, ramTiers),
      storage: Math.ceil(storage * 1.5 / 20) * 20,
    },
  ];

  return {
    project: projectNames[answers.project ?? ""] ?? "پروژه‌ی تو",
    management: managementNames[answers.management ?? ""] ?? "آماده‌به‌کار",
    location: locationNames[answers.location ?? ""] ?? "بعد از بررسی",
    profiles,
  };
}

export function CompassWizard({ initialAnswers = {} }: { initialAnswers?: CompassAnswers }) {
  const [answers, setAnswers] = useState<CompassAnswers>(initialAnswers);
  const [stepIndex, setStepIndex] = useState(() => firstOpenStep(initialAnswers));
  const [showResult, setShowResult] = useState(() => steps.every((step) => Boolean(initialAnswers[step.id])));
  const [selectedPlanId, setSelectedPlanId] = useState<PlanProfile["id"]>("balanced");
  const [parchinEnabled, setParchinEnabled] = useState(() => initialAnswers.management !== "raw");
  const [copied, setCopied] = useState(false);

  const step = steps[stepIndex];
  const selected = answers[step.id];
  const result = useMemo(() => buildResult(answers), [answers]);
  const selectedPlan = result.profiles.find((plan) => plan.id === selectedPlanId) ?? result.profiles[1];
  const parchinIsRequired = answers.management === "managed";
  const parchinIsActive = parchinIsRequired || parchinEnabled;

  const choose = (value: string) => {
    setAnswers((current) => ({ ...current, [step.id]: value }));
  };

  const next = () => {
    if (!selected) return;
    if (stepIndex === steps.length - 1) {
      setParchinEnabled(answers.management !== "raw");
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
    setSelectedPlanId("balanced");
    setParchinEnabled(false);
    setCopied(false);
  };

  const requestSummary = [
    `پروژه: ${result.project}`,
    `چینش: ${selectedPlan.title}`,
    `منابع اولیه: ${selectedPlan.cpu} vCPU / ${selectedPlan.ram} GB RAM / ${selectedPlan.storage} GB Storage`,
    `موقعیت: ${result.location}`,
    `سطح همراهی: ${result.management}`,
    `پرچین: ${parchinIsActive ? "فعال" : "غیرفعال"}`,
  ].join("\n");

  const contactHref = `mailto:hello@abrchin.ir?subject=${encodeURIComponent(`بررسی پیشنهاد ${result.project}`)}&body=${encodeURIComponent(`سلام ابرچین،\n\nاین پیشنهاد رو برای بررسی انتخاب کردم:\n${requestSummary}\n\nلطفاً قیمت روز و زمان راه‌اندازی رو اعلام کنید.`)}`;

  const copyRequest = async () => {
    await navigator.clipboard.writeText(requestSummary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (showResult) {
    return (
      <section className="compass-result page-view" aria-labelledby="result-title">
        <header className="result-heading">
          <div>
            <div className="eyebrow eyebrow-success"><Check size={16} aria-hidden="true" /> پیشنهاد اولیه آماده‌ست</div>
            <h1 id="result-title">سه مسیر برای {result.project}</h1>
            <p>چینش دلخواهت رو انتخاب کن؛ قیمت روز و موجودی قبل از خرید تأیید می‌شه.</p>
          </div>
          <button className="button button-quiet" type="button" onClick={restart}>
            <RefreshCw size={17} aria-hidden="true" />
            شروع دوباره
          </button>
        </header>

        <div className="result-layout">
          <div className="plan-choices" aria-label="انتخاب چینش پیشنهادی">
            {result.profiles.map((plan) => {
              const active = selectedPlan.id === plan.id;
              return (
                <button
                  key={plan.id}
                  className={`plan-choice${active ? " active" : ""}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <span className="plan-choice-top">
                    <span>{plan.recommended ? "پیشنهاد ابرچین" : "مسیر جایگزین"}</span>
                    <span className="plan-radio">{active && <Check size={14} aria-hidden="true" />}</span>
                  </span>
                  <strong>{plan.title}</strong>
                  <p>{plan.description}</p>
                  <span className="plan-resources" dir="ltr">
                    <span>{plan.cpu} <small>vCPU</small></span>
                    <span>{plan.ram} <small>GB RAM</small></span>
                    <span>{plan.storage} <small>GB</small></span>
                  </span>
                </button>
              );
            })}

            <button
              className={`parchin-choice${parchinIsActive ? " active" : ""}`}
              type="button"
              aria-pressed={parchinIsActive}
              disabled={parchinIsRequired}
              onClick={() => setParchinEnabled((current) => !current)}
            >
              <span className="parchin-icon"><ShieldCheck size={24} aria-hidden="true" /></span>
              <span>
                <small>قابلیت حفاظتی ابرچین</small>
                <strong>پرچین {parchinIsActive ? "فعاله" : "اختیاریه"}</strong>
                <p>امن‌سازی، پایش، بکاپ و هشدارهای ضروری.</p>
              </span>
              <span className="toggle" aria-hidden="true"><span /></span>
            </button>
          </div>

          <article className="result-card">
            <div className="result-card-head">
              <div>
                <span>چینش انتخابی تو</span>
                <h2>{selectedPlan.title}</h2>
              </div>
              <span className="result-badge"><Sparkles size={22} aria-hidden="true" /></span>
            </div>

            <div className="resource-grid" dir="ltr">
              <div><span>CPU</span><strong>{selectedPlan.cpu} vCPU</strong></div>
              <div><span>RAM</span><strong>{selectedPlan.ram} GB</strong></div>
              <div><span>STORAGE</span><strong>{selectedPlan.storage} GB</strong></div>
            </div>

            <div className="result-details">
              <div><MapPin size={19} aria-hidden="true" /><span>موقعیت</span><strong>{result.location}</strong></div>
              <div><HeartHandshake size={19} aria-hidden="true" /><span>همراهی</span><strong>{result.management}</strong></div>
              <div><Clock3 size={19} aria-hidden="true" /><span>راه‌اندازی</span><strong>بعد از تأیید</strong></div>
              <div><ShieldCheck size={19} aria-hidden="true" /><span>پرچین</span><strong>{parchinIsActive ? "فعال" : "اختیاری"}</strong></div>
            </div>

            <div className="quote-box">
              <span>قیمت نهایی</span>
              <strong>استعلام قیمت روز</strong>
              <small>منابع، موجودی و هزینه قبل از خرید با تو تأیید می‌شن.</small>
            </div>

            <div className="result-actions">
              <a className="button button-primary button-large" href={contactHref}>
                درخواست قیمت و راه‌اندازی
                <ArrowLeft size={19} aria-hidden="true" />
              </a>
              <button className="button button-quiet" type="button" onClick={copyRequest}>
                <Copy size={17} aria-hidden="true" />
                {copied ? "کپی شد" : "کپی خلاصه"}
              </button>
            </div>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="compass-page page-view" aria-labelledby="compass-title">
      <div className="wizard-main">
        <div className="wizard-heading">
          <div>
            <div className="eyebrow"><Compass size={16} aria-hidden="true" /> قطب‌نمای ابرچین</div>
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
                <span className="wizard-option-icon"><Icon size={24} aria-hidden="true" /></span>
                <strong>{option.label}</strong>
                <span className="wizard-check">{active && <Check size={14} aria-hidden="true" />}</span>
              </button>
            );
          })}
        </div>

        <div className="wizard-footer">
          {stepIndex === 0 ? (
            <Link className="wizard-back" href="/"><MoveRight size={18} aria-hidden="true" /> خانه</Link>
          ) : (
            <button className="wizard-back" type="button" onClick={back}><MoveRight size={18} aria-hidden="true" /> مرحله قبل</button>
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
          <span className="summary-symbol"><Store size={28} /></span>
        </div>
        <span className="summary-label">تا اینجا</span>
        <h2>{answers.project ? projectNames[answers.project] : "پروژه‌ی تو"}</h2>
        <div className="summary-list">
          <span><small>مرحله</small><strong>{answers.stage ? "مشخص شد" : "—"}</strong></span>
          <span><small>اندازه</small><strong>{answers.scale ? "مشخص شد" : "—"}</strong></span>
          <span><small>همراهی</small><strong>{answers.management ? managementNames[answers.management] : "—"}</strong></span>
        </div>
        <p>نوع زیرساخت، خروجی این مسیر است؛ لازم نیست از قبل انتخابش کنی.</p>
      </aside>
    </section>
  );
}

function toPersianDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
