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
  architecture: {
    id: "architecture",
    stepLabel: "شکل اجرا",
    prompt: "پروژه‌ات از چه بخش‌هایی تشکیل شده؟",
    helper: "لازم نیست معماری فنی را بدانی؛ نزدیک‌ترین تصویر را انتخاب کن.",
    explanation:
      "تعداد سرویس‌ها و وجود دیتابیس یا پردازش جدا، روی RAM، CPU و شیوه‌ی نگه‌داری اثر مستقیم دارد.",
    example: "یک سایت ساده با اپلیکیشن، دیتابیس و Worker یک نیاز یکسان ندارد.",
    decisionEffect: "اندازه‌ی پایه، حاشیه‌ی RAM و امکان خرید خودکار را دقیق‌تر می‌کند.",
    unknownNote: "حالت «اپ و دیتابیس» را به‌عنوان فرض محافظه‌کارانه ثبت می‌کنیم.",
    options: [
      { value: "single", label: "یک سرویس ساده", description: "سایت یا برنامه‌ی سبک", icon: "compute" },
      { value: "app_db", label: "اپ و دیتابیس", description: "برنامه همراه پایگاه داده", icon: "storage" },
      { value: "multi_service", label: "چند سرویس", description: "اپ، Worker، دیتابیس یا چند کانتینر", icon: "growth" },
      { value: "data_heavy", label: "داده و پردازش", description: "فایل، گزارش یا پردازش سنگین", icon: "storage" },
      { value: "unknown", label: "مطمئن نیستم", description: "با یک فرض روشن جلو می‌رویم", icon: "warning" },
    ],
  },
  storage: {
    id: "storage",
    stepLabel: "حجم واقعی",
    prompt: "داده و فایل‌ها در شروع تقریباً چقدرند؟",
    helper: "حجم فعلی مهم‌تر از حدس چند سال آینده است؛ مسیر ارتقا را جدا نگه می‌داریم.",
    explanation:
      "فضای سیستم‌عامل، دیتابیس، فایل‌ها و جای لازم برای بکاپ یا مهاجرت باید از ابتدا تفکیک شوند.",
    example: "زیر ۵۰ گیگ سبک است؛ آرشیو فایل یا دیتابیس بزرگ می‌تواند از ۲۰۰ گیگ عبور کند.",
    decisionEffect: "حداقل دیسک و امکان مهاجرت یا بکاپ امن را تعیین می‌کند.",
    unknownNote: "یک حجم متوسط با امکان بازبینی پیشنهاد می‌شود.",
    options: [
      { value: "small", label: "کمتر از ۵۰ گیگ", description: "شروع سبک یا داده‌ی محدود", icon: "storage" },
      { value: "medium", label: "۵۰ تا ۲۰۰ گیگ", description: "داده‌ی فعال و قابل رشد", icon: "storage" },
      { value: "large", label: "بیشتر از ۲۰۰ گیگ", description: "آرشیو، دیتابیس یا فایل زیاد", icon: "warning" },
      { value: "unknown", label: "نمی‌دونم", description: "بعداً از سرویس فعلی اندازه می‌گیریم", icon: "support" },
    ],
  },
  growth: {
    id: "growth",
    stepLabel: "اتفاق بعدی",
    prompt: "در سه ماه آینده چه تغییری محتمل‌تره؟",
    helper: "ظرفیت امروز را جدا از رشد نزدیک می‌سنجیم تا نه کم بخری و نه بی‌دلیل زیاد.",
    explanation:
      "کمپین و رشد سریع می‌تواند نیاز لحظه‌ای را چند برابر کند؛ اما رشد پایدار معمولاً با ارتقای مرحله‌ای بهتر مدیریت می‌شود.",
    example: "لانچ عمومی، تبلیغات یا ورود مشتری بزرگ یک جهش مصرف محسوب می‌شود.",
    decisionEffect: "روی حاشیه ظرفیت و قابلیت Resize اثر می‌گذارد.",
    unknownNote: "رشد پایدار فرض می‌شود و امکان ارتقا حفظ خواهد شد.",
    options: [
      { value: "stable", label: "تقریباً ثابت", description: "رشد آرام و قابل پیش‌بینی", icon: "compute" },
      { value: "campaign", label: "کمپین یا لانچ", description: "یک پیک مشخص در پیش است", icon: "traffic" },
      { value: "rapid", label: "رشد سریع", description: "کاربر یا پردازش مدام بیشتر می‌شود", icon: "growth" },
      { value: "unknown", label: "هنوز مشخص نیست", description: "مسیر ارتقا را باز نگه می‌داریم", icon: "warning" },
    ],
  },
  downtime: {
    id: "downtime",
    stepLabel: "مهاجرت امن",
    prompt: "برای انتقال، چقدر توقف قابل قبوله؟",
    helper: "این پاسخ مشخص می‌کند مهاجرت خودکار کافی است یا باید برنامه‌ی Cutover داشته باشیم.",
    explanation:
      "انتقال تقریباً بدون توقف معمولاً به همگام‌سازی داده، تست و مسیر بازگشت نیاز دارد و خرید مستقیم یک سرور به‌تنهایی کافی نیست.",
    example: "برای سرویس فعال فروش، توقف چندساعته با یک سایت آرشیوی یکسان نیست.",
    decisionEffect: "می‌تواند خرید مستقیم را متوقف و مسیر همراهی مهاجرت را فعال کند.",
    unknownNote: "توقف کوتاه به‌عنوان فرض اولیه ثبت می‌شود و قبل از اجرا بازبینی خواهد شد.",
    options: [
      { value: "flexible", label: "چند ساعت مشکلی نیست", description: "انتقال برنامه‌ریزی‌شده", icon: "support" },
      { value: "short", label: "حداکثر چند دقیقه", description: "نیازمند Cutover کنترل‌شده", icon: "managed-shield" },
      { value: "near_zero", label: "تقریباً بدون توقف", description: "نیازمند طراحی مهاجرت و بازگشت", icon: "warning" },
      { value: "unknown", label: "مطمئن نیستم", description: "قبل از خرید بررسی می‌کنیم", icon: "question-help" },
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
    prompt: "پرچین ابرچین برای این سرور چه کمکی می‌کند؟",
    helper: "همه سرورهای ابرچین با پرچین پایه و تحویل کنترل‌شده ارائه می‌شوند.",
    explanation:
      "پرچین پایه شامل تحویل کنترل‌شده، دسترسی امن یک‌بارمصرف و پیگیری راه‌اندازی است. پایش، بکاپ و نگه‌داری روزمره فقط وقتی جداگانه در سفارش ثبت شوند.",
    example: "ابرچین سرور را با تنظیمات قفل‌شده Quote تحویل می‌دهد و سلامت اولیه را بررسی می‌کند.",
    decisionEffect: "دامنه مسئولیت تحویل و خدمات قابل اتکا را شفاف می‌کند.",
    unknownNote: "همراه ابرچین انتخاب می‌شود و مسئولیت‌ها قبل از پرداخت نمایش داده می‌شوند.",
    options: [
      { value: "managed", label: "همراه ابرچین", description: "پرچین پایه و پیگیری تحویل", icon: "managed-shield" },
      { value: "unknown", label: "این یعنی چی؟", description: "دامنه پرچین را توضیح می‌دهیم", icon: "support" },
    ],
  },
};

export function getRecommendationQuestionOrder(
  answers: RecommendationAnswers,
): QuestionId[] {
  // Four high-signal questions are always asked. Exactly one branch may be
  // added, keeping the conversational discovery between 4 and 5 questions.
  // Region and Parchin are deliberate configuration steps after the main
  // recommendation, not extra discovery questions.
  const order: QuestionId[] = ["project", "stage", "usage", "criticality"];
  const migration = answers.project === "migration" || answers.stage === "migration";
  const dataSensitive =
    answers.project === "data" ||
    answers.architecture === "data_heavy" ||
    migration;
  const growthSensitive =
    answers.stage === "launch" ||
    answers.stage === "active" ||
    answers.stage === "growing" ||
    answers.usage === "daily" ||
    answers.usage === "busy";

  if (migration) order.push("downtime");
  else if (dataSensitive) order.push("storage");
  else if (growthSensitive) order.push("growth");
  else order.push("architecture");
  return order;
}

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
    case "architecture":
      return answers.project === "site" ? "single" : "app_db";
    case "storage":
      return "unknown";
    case "growth":
      return answers.stage === "growing" ? "rapid" : "stable";
    case "downtime":
      return "short";
  }
}
