import type {
  AnswerSources,
  ArchitectureKind,
  CriticalityKind,
  DowntimeKind,
  GrowthKind,
  ManagementKind,
  RecommendationAnswers,
  RecommendationAssumption,
  RecommendationDirection,
  RecommendationResult,
  ResourceProfile,
  StorageKind,
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
  if (answers.management !== "managed") {
    assumptions.push({
      field: "management",
      label: "سطح همراهی",
      value: "همراه ابرچین",
      reason: "تمام سرورهای ابرچین با پرچین پایه و تحویل کنترل‌شده ارائه می‌شوند.",
      source: "default",
    });
  }
  return "managed";
}

function resolveArchitecture(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): Exclude<ArchitectureKind, "unknown"> {
  if (answers.architecture && answers.architecture !== "unknown") return answers.architecture;
  const value: Exclude<ArchitectureKind, "unknown"> =
    answers.project === "site" ? "single" : answers.project === "data" ? "data_heavy" : "app_db";
  assumptions.push({
    field: "architecture",
    label: "شکل اجرا",
    value:
      value === "single"
        ? "یک سرویس ساده"
        : value === "data_heavy"
          ? "داده و پردازش"
          : "اپ و دیتابیس",
    reason: "اجزای فنی دقیق نبود؛ از نوع پروژه یک شکل اجرای قابل بازبینی ساختیم.",
    source: "estimate",
  });
  return value;
}

function resolveStorage(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): Exclude<StorageKind, "unknown"> {
  if (answers.storage && answers.storage !== "unknown") return answers.storage;
  assumptions.push({
    field: "storage",
    label: "حجم داده",
    value: "حجم متوسط و قابل ارتقا",
    reason: "اندازه‌ی دقیق داده مشخص نبود؛ فضای کافی برای شروع و اندازه‌گیری واقعی در نظر گرفتیم.",
    source: "estimate",
  });
  return "medium";
}

function resolveGrowth(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): Exclude<GrowthKind, "unknown"> {
  if (answers.growth && answers.growth !== "unknown") return answers.growth;
  assumptions.push({
    field: "growth",
    label: "رشد نزدیک",
    value: answers.stage === "growing" ? "رشد سریع" : "رشد پایدار",
    reason: "برنامه‌ی سه ماه آینده قطعی نبود؛ مسیر ارتقای مرحله‌ای باز نگه داشته شد.",
    source: "estimate",
  });
  return answers.stage === "growing" ? "rapid" : "stable";
}

function resolveDowntime(
  answers: RecommendationAnswers,
  assumptions: RecommendationAssumption[],
): Exclude<DowntimeKind, "unknown"> {
  if (answers.downtime && answers.downtime !== "unknown") return answers.downtime;
  assumptions.push({
    field: "downtime",
    label: "توقف مهاجرت",
    value: "توقف کوتاه و کنترل‌شده",
    reason: "محدودیت توقف مشخص نبود؛ قبل از اجرا باید Cutover و مسیر بازگشت تأیید شود.",
    source: "estimate",
  });
  return "short";
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
  resolveManagement(answers, assumptions);
  const architecture = resolveArchitecture(answers, assumptions);
  const migration = project === "migration" || stage === "migration";
  const dataSensitive =
    project === "data" || architecture === "data_heavy" || migration;
  const growthSensitive =
    stage === "launch" ||
    stage === "active" ||
    stage === "growing" ||
    usage === "daily" ||
    usage === "busy";
  const storage = dataSensitive ? resolveStorage(answers, assumptions) : "small";
  const growth = growthSensitive ? resolveGrowth(answers, assumptions) : "stable";
  const downtime = migration ? resolveDowntime(answers, assumptions) : "flexible";

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
    reasons.push("اثر قطعی روی کار یا درآمد، نیاز به بکاپ روزانه و مسیر بازیابی واقعی را بالا می‌برد.");
  }

  if (architecture === "app_db") {
    ramGb += 2;
    reasons.push("برای اجرای هم‌زمان برنامه و دیتابیس، حاشیه‌ی RAM جدا در نظر گرفته شده.");
  } else if (architecture === "multi_service") {
    vcpu += 2;
    ramGb += 4;
    storageGb += 20;
    reasons.push("چند سرویس یا Worker به ظرفیت هم‌زمان و حافظه‌ی بیشتری نیاز دارد.");
  } else if (architecture === "data_heavy") {
    vcpu += 4;
    ramGb += 8;
    storageGb += 80;
    reasons.push("پردازش داده و فایل از چینش عمومی جدا و با ظرفیت بالاتر محاسبه شده.");
  }

  if (storage === "medium") {
    storageGb = Math.max(storageGb, 200);
  } else if (storage === "large") {
    storageGb = Math.max(storageGb, 500);
    reasons.push("حجم بالای داده، فضای عملیاتی و مسیر بکاپ جدا می‌خواهد.");
  }

  if (growth === "campaign") {
    vcpu += 2;
    ramGb += 4;
    reasons.push("برای کمپین یا لانچ نزدیک، ظرفیت پیک کوتاه‌مدت لحاظ شده.");
  } else if (growth === "rapid") {
    vcpu += 4;
    ramGb += 8;
    reasons.push("رشد سریع به حاشیه‌ی بیشتر و امکان Resize بدون تعویض مسیر خرید نیاز دارد.");
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
    deliveryMode: "MANAGED",
    backupPolicy,
    needsResize:
      stage === "growing" ||
      usage === "busy" ||
      growth === "campaign" ||
      growth === "rapid",
  };

  const architectureCpuFloor =
    architecture === "multi_service"
      ? baseline.vcpu + 2
      : architecture === "data_heavy"
        ? baseline.vcpu + 4
        : baseline.vcpu;
  const architectureRamFloor =
    architecture === "app_db"
      ? baseline.ramGb + 2
      : architecture === "multi_service"
        ? baseline.ramGb + 4
        : architecture === "data_heavy"
          ? baseline.ramGb + 8
          : baseline.ramGb;
  const storageFloor =
    storage === "large" ? 500 : storage === "medium" ? 200 : baseline.storageGb;
  const minimumProfile: ResourceProfile = {
    ...profile,
    vcpu: atLeastTier(architectureCpuFloor, cpuTiers),
    ramGb: atLeastTier(architectureRamFloor, ramTiers),
    storageGb: storageFloor,
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

  const architectureEscalation = criticality === "severe" || downtime === "near_zero";
  if (architectureEscalation) {
    caveats.unshift(
      downtime === "near_zero"
        ? "مهاجرت تقریباً بدون توقف به همگام‌سازی، تست Cutover و مسیر بازگشت نیاز دارد؛ خرید خودکار متوقف می‌شود."
        : "برای این سطح حساسیت، خرید خودکار یک سرور متوقف می‌شود؛ ابتدا باید معماری تحمل‌خطا بررسی شود.",
    );
  }

  reasons.push("حالت «همراه ابرچین» با پرچین پایه و دامنه‌ی مسئولیت شفاف در نظر گرفته شده.");

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
