import type {
  AnswerSources,
  CriticalityKind,
  ManagementKind,
  RecommendationAnswers,
  RecommendationAssumption,
  RecommendationDirection,
  RecommendationResult,
  ResourceProfile,
  UsageKind,
} from "@/lib/recommendation/types";

const cpuTiers = [1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const ramTiers = [2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

const workloadLabels: Record<string, string> = {
  site: "سایت و محتوا",
  commerce: "فروش آنلاین",
  product: "اپ و محصول",
  api: "API و سرویس",
  migration: "انتقال سرویس",
  data: "داده و پردازش",
  other: "پروژه‌ی منعطف",
};

const workloadBaselines: Record<string, { vcpu: number; ramGb: number; storageGb: number }> = {
  site: { vcpu: 2, ramGb: 4, storageGb: 60 },
  commerce: { vcpu: 4, ramGb: 8, storageGb: 100 },
  product: { vcpu: 4, ramGb: 8, storageGb: 80 },
  api: { vcpu: 4, ramGb: 8, storageGb: 60 },
  migration: { vcpu: 4, ramGb: 8, storageGb: 120 },
  data: { vcpu: 8, ramGb: 16, storageGb: 160 },
  other: { vcpu: 4, ramGb: 8, storageGb: 80 },
};

function atLeastTier(value: number, tiers: number[]) {
  return tiers.find((tier) => tier >= value) ?? Math.ceil(value / 16) * 16;
}

function previousTier(value: number, tiers: number[], floor: number) {
  const lower = tiers.filter((tier) => tier < value && tier >= floor);
  return lower.at(-1) ?? floor;
}

function nextTier(value: number, tiers: number[]) {
  return tiers.find((tier) => tier > value) ?? atLeastTier(value * 1.25, tiers);
}

function resolveUsage(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): UsageKind {
  if (answers.usage && answers.usage !== "unknown") return answers.usage;

  const value: UsageKind =
    answers.stage === "growing" || answers.project === "commerce" ? "daily" : "light";
  assumptions.push({
    field: "usage",
    label: "اندازه‌ی استفاده",
    value: value === "daily" ? "استفاده‌ی روزانه" : "استفاده‌ی سبک",
    reason: "عدد فنی مشخص نبود؛ از نوع پروژه و مرحله‌ی فعلی یک تخمین محافظه‌کارانه ساختیم.",
    source: "estimate",
  });
  return value;
}

function resolveCriticality(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): CriticalityKind {
  if (answers.criticality && answers.criticality !== "unknown") return answers.criticality;

  const value: CriticalityKind =
    answers.project === "commerce"
      ? "high"
      : answers.stage === "active" || answers.stage === "growing"
        ? "medium"
        : "low";
  assumptions.push({
    field: "criticality",
    label: "حساسیت قطعی",
    value:
      value === "high" ? "توقف فروش یا کار" : value === "medium" ? "آزاردهنده" : "کم‌ریسک",
    reason: "اثر قطعی مشخص نبود؛ سطحی متناسب با نوع و مرحله‌ی پروژه در نظر گرفتیم.",
    source: "default",
  });
  return value;
}

function resolveManagement(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): Exclude<ManagementKind, "unknown"> {
  if (answers.management && answers.management !== "unknown") return answers.management;
  assumptions.push({
    field: "management",
    label: "سطح همراهی",
    value: "همراه ابرچین",
    reason: "مسئولیت فنی مشخص نبود؛ گزینه‌ی امن‌تر را پیشنهاد دادیم و قبل از خرید قابل تغییر است.",
    source: "default",
  });
  return "managed";
}

export function buildRecommendation(
  answers: RecommendationAnswers,
  sources: AnswerSources = {},
): RecommendationResult {
  const project = answers.project ?? "other";
  const stage = answers.stage ?? "idea";
  const baseline = workloadBaselines[project] ?? workloadBaselines.other;
  const assumptions: RecommendationAssumption[] = [];
  const caveats: string[] = [];
  const reasons: string[] = [];

  if (!answers.project) {
    assumptions.push({
      field: "project",
      label: "نوع پروژه",
      value: workloadLabels.other,
      reason: "نوع پروژه کامل نبود؛ از یک نقطه‌ی شروع منعطف استفاده کردیم.",
      source: "default",
    });
  }

  const usage = resolveUsage(answers, assumptions);
  const criticality = resolveCriticality(answers, assumptions);
  const management = resolveManagement(answers, assumptions);

  let vcpu = baseline.vcpu;
  let ramGb = baseline.ramGb;
  let storageGb = baseline.storageGb;

  if (stage === "active") {
    vcpu += 2;
    ramGb += 4;
    storageGb += 20;
    reasons.push("چون سرویس کاربر واقعی دارد، منابع فقط روی حد آزمایشی نمانده‌اند.");
  } else if (stage === "growing") {
    vcpu += 4;
    ramGb += 8;
    storageGb += 40;
    reasons.push("برای رشد نزدیک، یک پله جا بدون خرید افراطی در نظر گرفته شده.");
  } else if (stage === "migration") {
    vcpu += 2;
    ramGb += 4;
    storageGb += 40;
    reasons.push("در انتقال سرویس، حاشیه‌ی امن برای رفتار واقعی و جابه‌جایی داده اضافه شده.");
  }

  if (usage === "daily") {
    vcpu += 2;
    ramGb += 4;
    reasons.push("مصرف روزانه به CPU و RAM پیوسته‌تری نسبت به یک نمونه‌ی آزمایشی نیاز دارد.");
  } else if (usage === "busy") {
    vcpu += 4;
    ramGb += 8;
    storageGb += 40;
    reasons.push("برای پیک یا پردازش سنگین، ظرفیت لحظه‌ای بیشتری نگه داشته شده.");
  } else if (usage === "starting") {
    reasons.push("چون هنوز مصرف واقعی شروع نشده، پیشنهاد از اندازه‌ی پایه فراتر نرفته.");
  }

  if (criticality === "high" || criticality === "severe") {
    ramGb += 4;
    reasons.push("اثر قطعی روی کار یا درآمد، بکاپ روزانه و همراهی عملیاتی را مهم می‌کند.");
  }

  vcpu = atLeastTier(vcpu, cpuTiers);
  ramGb = atLeastTier(ramGb, ramTiers);
  storageGb = Math.ceil(storageGb / 20) * 20;

  const backupPolicy =
    criticality === "high" || criticality === "severe"
      ? "DAILY"
      : criticality === "medium"
        ? "WEEKLY"
        : "NONE";

  const profile: ResourceProfile = {
    vcpu,
    ramGb,
    storageGb,
    regionPreference: "IRAN",
    deliveryMode: management === "managed" ? "MANAGED" : "RAW",
    backupPolicy,
    needsResize: stage === "growing" || usage === "busy",
  };

  const minimumProfile: ResourceProfile = {
    ...profile,
    vcpu: baseline.vcpu,
    ramGb: baseline.ramGb,
    storageGb: baseline.storageGb,
  };

  if (answers.audience === "abroad") {
    caveats.push(
      "نسخه‌ی سریع فعلاً سرور ایران می‌سازد؛ برای کاربرهای عمدتاً خارج، تأخیر شبکه باید قبل از خرید بررسی شود.",
    );
  } else if (answers.audience === "mixed") {
    caveats.push(
      "برای کاربرهای ایران و خارج، یک سرور ایران نقطه‌ی شروع است؛ CDN یا معماری چندمنطقه‌ای می‌تواند مرحله‌ی بعد باشد.",
    );
  } else if (!answers.audience || answers.audience === "unknown") {
    assumptions.push({
      field: "audience",
      label: "موقعیت کاربرها",
      value: "ایران برای نسخه‌ی سریع",
      reason: "موقعیت قطعی نبود؛ انتخاب ایران به‌عنوان فرض قابل‌تغییر ثبت شد.",
      source: "default",
    });
  }

  const architectureEscalation = criticality === "severe";
  if (architectureEscalation) {
    caveats.unshift(
      "برای این سطح حساسیت، خرید خودکار یک سرور متوقف می‌شود؛ ابتدا باید معماری تحمل‌خطا بررسی شود.",
    );
  }

  if (management === "managed") {
    reasons.push("حالت «همراه ابرچین» با پرچین و مسئولیت عملیاتی شفاف در نظر گرفته شده.");
  } else {
    reasons.push("سرور خام انتخاب شده و مدیریت سیستم‌عامل و دسترسی‌ها با خودت می‌ماند.");
  }

  const nonUserSources = Object.values(sources).filter((source) => source && source !== "user").length;
  const uncertainty = assumptions.length + nonUserSources;
  const confidence = uncertainty === 0 ? "high" : uncertainty <= 2 ? "medium" : "low";

  return {
    title: architectureEscalation ? "اول معماری، بعد سرور" : "چینش پیشنهادی ابرچین",
    summary: architectureEscalation
      ? "نیازت از یک سرور تنها حساس‌تر است؛ مشخصاتت حفظ می‌شود تا مسیر درست را با همراهی جلو ببریم."
      : `${workloadLabels[project]} با منابع متعادل برای امروز و یک مسیر روشن برای رشد.`,
    workloadLabel: workloadLabels[project],
    profile,
    minimumProfile,
    confidence,
    reasons,
    assumptions,
    caveats,
    architectureEscalation,
  };
}

export function adjustRecommendationProfile(
  recommendation: RecommendationResult,
  direction: RecommendationDirection,
): ResourceProfile {
  if (direction === "balanced") return recommendation.profile;

  if (direction === "economy") {
    return {
      ...recommendation.profile,
      vcpu: previousTier(
        recommendation.profile.vcpu,
        cpuTiers,
        recommendation.minimumProfile.vcpu,
      ),
      ramGb: previousTier(
        recommendation.profile.ramGb,
        ramTiers,
        recommendation.minimumProfile.ramGb,
      ),
      storageGb: Math.max(
        recommendation.minimumProfile.storageGb,
        Math.floor(recommendation.profile.storageGb * 0.8 / 20) * 20,
      ),
    };
  }

  return {
    ...recommendation.profile,
    vcpu: nextTier(recommendation.profile.vcpu, cpuTiers),
    ramGb: nextTier(recommendation.profile.ramGb, ramTiers),
    storageGb: Math.ceil(recommendation.profile.storageGb * 1.35 / 20) * 20,
    needsResize: true,
  };
}
