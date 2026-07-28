import type {
  QuestionId,
  RecommendationAnswers,
  RecommendationQuestion,
} from "@/lib/recommendation/types";

const questions: Record<QuestionId, RecommendationQuestion> = {
  project: {
    id: "project",
    stepLabel: "شروع از نیاز",
    prompt: "چی می‌سازی یا می‌خواهی منتقل کنی؟",
    helper: "لازم نیست اسم تکنولوژی را بدانی؛ خودِ کاری که سرویس انجام می‌دهد مهم است.",
    explanation:
      "نوع پروژه نقطه‌ی شروع CPU، RAM و فضای ذخیره‌سازی را مشخص می‌کند. بعد با چند نشانه‌ی واقعی، اندازه را دقیق‌تر می‌کنیم.",
    example: "مثلاً «فروشگاه با پرداخت آنلاین» یا «API برای اپ موبایل».",
    decisionEffect: "روی اندازه‌ی پایه‌ی سرور و سؤال بعدی اثر می‌گذارد.",
    unknownNote: "نزدیک‌ترین مثال را انتخاب کن؛ بعداً می‌توانی برداشت ابرچین را عوض کنی.",
    options: [
      { value: "site", label: "سایت و محتوا", description: "وب‌سایت، وبلاگ یا لندینگ", icon: "storage" },
      { value: "commerce", label: "فروش آنلاین", description: "فروشگاه، سفارش و پرداخت", icon: "traffic" },
      { value: "product", label: "اپ و محصول", description: "پنل، SaaS یا محصول تعاملی", icon: "growth" },
      { value: "api", label: "API و سرویس", description: "بک‌اند، بات یا اتوماسیون", icon: "compute" },
      { value: "migration", label: "انتقال سرویس", description: "جابجایی یک سرویس فعال", icon: "support" },
      { value: "data", label: "داده و پردازش", description: "گزارش، پردازش یا کارهای پس‌زمینه", icon: "compute" },
      { value: "other", label: "چیز دیگه", description: "با یک شروع منعطف جلو می‌رویم", icon: "support" },
    ],
  },
  audience: {
    id: "audience",
    stepLabel: "نزدیک کاربرها",
    prompt: "کاربرهات بیشتر کجا هستند؟",
    helper: "نزدیکی سرور به کاربر معمولاً سرعت پاسخ را بهتر می‌کند.",
    explanation:
      "موقعیت کاربرها برای انتخاب دیتاسنتر و هزینه‌ی ترافیک مهم است. نسخه‌ی سریع ابرچین فعلاً سرور ایران می‌سازد.",
    example: "اگر هنوز کاربر نداری، بازار هدفی را بگو که اول واردش می‌شوی.",
    decisionEffect: "روی موقعیت سرور، تأخیر شبکه و هشدارهای پیشنهاد اثر می‌گذارد.",
    unknownNote: "بدون حدس قطعی جلو می‌رویم و موقعیت ایران را به‌عنوان فرض قابل‌تغییر علامت می‌زنیم.",
    options: [
      { value: "iran", label: "بیشتر ایران", description: "اولویت با کمترین تأخیر داخل ایران", icon: "location" },
      { value: "mixed", label: "ایران و خارج", description: "کاربرها بین چند منطقه پخش‌اند", icon: "traffic" },
      { value: "abroad", label: "بیشتر خارج", description: "بازار اصلی بیرون از ایران است", icon: "location" },
      { value: "unknown", label: "هنوز نمی‌دونم", description: "موقعیت را به‌صورت تخمینی نگه می‌داریم", icon: "warning" },
    ],
  },
  stage: {
    id: "stage",
    stepLabel: "جای فعلی پروژه",
    prompt: "الان در چه مرحله‌ای هستی؟",
    helper: "نیاز یک نمونه‌ی آزمایشی با محصول فعال و در حال رشد یکی نیست.",
    explanation:
      "مرحله‌ی محصول کمک می‌کند برای شروع بیش‌ازحد نخری و در عین حال برای مصرف واقعی کم نیاوری.",
    example: "اگر کاربر واقعی داری، «فعال» را انتخاب کن؛ حتی اگر تعدادشان هنوز کم است.",
    decisionEffect: "حاشیه‌ی منابع و میزان ریسک پیشنهاد را تغییر می‌دهد.",
    unknownNote: "اگر هنوز کاربر واقعی نداری، «ایده و تست» شروع امن‌تری است.",
    options: [
      { value: "idea", label: "ایده و تست", description: "هنوز در حال ساخت و آزمایش", icon: "compute" },
      { value: "launch", label: "آماده‌ی شروع", description: "نزدیک انتشار یا شروع فروش", icon: "growth" },
      { value: "active", label: "فعال و کم‌مصرف", description: "کاربر واقعی با مصرف کنترل‌شده", icon: "traffic" },
      { value: "growing", label: "فعال و رو‌به‌رشد", description: "مصرف یا کاربرها در حال زیادشدن", icon: "growth" },
      { value: "migration", label: "در حال انتقال", description: "مصرف فعلی را باید حفظ کنیم", icon: "support" },
    ],
  },
  usage: {
    id: "usage",
    stepLabel: "اندازه‌ی استفاده",
    prompt: "شلوغ‌ترین زمان سرویس تقریباً چطوره؟",
    helper: "یک تخمین ساده کافی است؛ لازم نیست عدد فنی دقیق داشته باشی.",
    explanation:
      "منظور، فشار واقعی در یک بازه‌ی کوتاه است؛ مثل تعداد خرید هم‌زمان، درخواست‌های API یا پردازش‌هایی که با هم اجرا می‌شوند.",
    example: "یک فروشگاه در زمان کمپین می‌تواند چند برابر روز معمول شلوغ شود.",
    decisionEffect: "بیشترین اثر را روی CPU و RAM پیشنهادی دارد.",
    unknownNote: "از نوع پروژه و مرحله‌ی فعلی یک تخمین محافظه‌کارانه می‌سازیم و واضح علامت می‌زنیم.",
    options: [
      { value: "starting", label: "هنوز شروع نشده", description: "فعلاً مصرف واقعی ندارم", icon: "compute" },
      { value: "light", label: "سبک", description: "کاربر یا درخواست هم‌زمان کم", icon: "traffic" },
      { value: "daily", label: "استفاده‌ی روزانه", description: "مصرف پیوسته و قابل پیش‌بینی", icon: "traffic" },
      { value: "busy", label: "شلوغ یا جهشی", description: "پیک، کمپین یا پردازش سنگین", icon: "growth" },
      { value: "unknown", label: "نمی‌دونم", description: "ابرچین از نشانه‌های قبلی تخمین می‌زند", icon: "warning" },
    ],
  },
  criticality: {
    id: "criticality",
    stepLabel: "ریسک واقعی",
    prompt: "اگر سرویس یک ساعت قطع بشه، چه اتفاقی می‌افته؟",
    helper: "این سؤال اثر کسب‌وکاری قطعی را می‌سنجد، نه توان فنی تو را.",
    explanation:
      "هرچه توقف پرهزینه‌تر باشد، بکاپ، پایش و معماری امن‌تر مهم‌تر می‌شود. برای نیاز حیاتی، یک سرور تنها قول درستی نیست.",
    example: "قطعی وبلاگ شخصی با توقف فروش یا عملیات یک تیم فرق دارد.",
    decisionEffect: "روی بکاپ، پرچین و امکان خرید خودکار اثر مستقیم دارد.",
    unknownNote: "براساس نوع پروژه یک سطح محافظه‌کارانه انتخاب می‌کنیم و آن را قطعی جلوه نمی‌دهیم.",
    options: [
      { value: "low", label: "مشکلی نیست", description: "می‌توانم بعداً پیگیری کنم", icon: "backup" },
      { value: "medium", label: "آزاردهنده‌ست", description: "روی تجربه یا کار تیم اثر می‌گذارد", icon: "warning" },
      { value: "high", label: "فروش یا کار می‌ایسته", description: "اثر مستقیم روی درآمد یا عملیات", icon: "managed-shield" },
      { value: "severe", label: "خسارت جدی داره", description: "نیازمند معماری فراتر از یک سرور", icon: "warning" },
      { value: "unknown", label: "مطمئن نیستم", description: "با یک فرض قابل بازبینی جلو می‌رویم", icon: "support" },
    ],
  },
  management: {
    id: "management",
    stepLabel: "سطح همراهی",
    prompt: "سرور رو خام می‌خوای یا همراه ابرچین؟",
    helper: "خام یعنی مدیریت سیستم‌عامل با خودت؛ همراه یعنی راه‌اندازی امن و کمک عملیاتی.",
    explanation:
      "در حالت خام، به‌روزرسانی، SSH، فایروال و رفع خطا با خودت است. «همراه ابرچین» دامنه‌ی مشخص دارد و هزینه‌اش جدا نمایش داده می‌شود.",
    example: "اگر نمی‌خواهی درگیر SSH و مراقبت روزمره شوی، حالت همراه مناسب‌تر است.",
    decisionEffect: "نوع تحویل، پرچین، مسئولیت‌ها و مبلغ نهایی را تغییر می‌دهد.",
    unknownNote: "حالت همراه را پیشنهاد می‌دهیم؛ قبل از پرداخت می‌توانی به خام تغییرش بدهی.",
    options: [
      { value: "raw", label: "سرور خام", description: "کنترل و مدیریت کامل با خودم", icon: "raw-server" },
      { value: "managed", label: "همراه ابرچین", description: "راه‌اندازی امن، پرچین و کمک عملیاتی", icon: "managed-shield" },
      { value: "unknown", label: "کمکم کن انتخاب کنم", description: "مسئولیت‌ها را مقایسه و پیشنهاد می‌دهیم", icon: "support" },
    ],
  },
};

export const recommendationQuestionOrder: QuestionId[] = [
  "project",
  "audience",
  "stage",
  "usage",
  "criticality",
  "management",
];

export function getRecommendationQuestion(
  id: QuestionId,
  answers: RecommendationAnswers,
): RecommendationQuestion {
  const question = questions[id];

  if (id !== "usage") return question;

  if (answers.project === "data") {
    return {
      ...question,
      prompt: "حجم پردازش یا داده‌ات در شروع چقدره؟",
      helper: "یک برآورد کلی از سبک تا سنگین کافی است؛ بعداً با مصرف واقعی اصلاحش می‌کنیم.",
      example: "گزارش‌های گه‌گاهی سبک‌اند؛ پردازش دائمی فایل یا داده، شلوغ حساب می‌شود.",
    };
  }

  if (answers.project === "migration") {
    return {
      ...question,
      prompt: "مصرف سرویس فعلی در شلوغ‌ترین زمان چقدره؟",
      helper: "اگر عدد دقیق نداری، از کندشدن‌ها، تعداد کاربر و زمان‌های پیک بگو.",
      example: "اگر سرویس فعلی در ساعات مشخص کند می‌شود، گزینه‌ی شلوغ یا جهشی امن‌تر است.",
    };
  }

  return question;
}

export function getDefaultAssistedAnswer(
  id: QuestionId,
  answers: RecommendationAnswers,
): string {
  switch (id) {
    case "project":
      return "other";
    case "audience":
      return "unknown";
    case "stage":
      return "idea";
    case "usage":
      if (answers.stage === "growing" || answers.project === "commerce") return "daily";
      return "light";
    case "criticality":
      if (answers.project === "commerce") return "high";
      if (answers.stage === "active" || answers.stage === "growing") return "medium";
      return "low";
    case "management":
      return "managed";
  }
}
