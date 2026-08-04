import type {
  QuestionId,
  RecommendationAnswers,
  RecommendationQuestion,
} from "@/lib/recommendation/types";

const questions: Record<QuestionId, RecommendationQuestion> = {
  project: {
    id: "project",
    stepLabel: "هدف",
    prompt: "هدف اصلی‌ات چیه؟",
    helper: "با همین جواب، گفت‌وگو رو از نیاز واقعی‌ات شروع می‌کنیم؛ اسم تکنولوژی لازم نیست.",
    explanation:
      "نوع پروژه نقطه‌ی شروع CPU، RAM و فضای ذخیره‌سازی را مشخص می‌کند. بعد با چند نشانه‌ی واقعی، اندازه را دقیق‌تر می‌کنیم.",
    example: "مثلاً «فروشگاه با پرداخت آنلاین» یا «API برای اپ موبایل».",
    decisionEffect: "روی اندازه‌ی پایه‌ی سرور و مسیر خدمت اثر می‌گذارد.",
    unknownNote: "نزدیک‌ترین مثال را انتخاب کن؛ بعداً می‌توانی برداشت ابرچین را عوض کنی.",
    options: [
      { value: "site", label: "سایت و محتوا", description: "وب‌سایت، وبلاگ یا لندینگ", icon: "storage" },
      { value: "commerce", label: "فروشگاه آنلاین", description: "فروشگاه، سفارش و پرداخت", icon: "traffic" },
      { value: "product", label: "اپ و محصول", description: "پنل، SaaS یا محصول تعاملی", icon: "growth" },
      { value: "api", label: "API و سرویس", description: "بک‌اند، بات یا اتوماسیون", icon: "compute" },
      { value: "migration", label: "مهاجرت سرویس", description: "انتقال سایت یا سورس فعال", icon: "support" },
      { value: "data", label: "دیتابیس و پردازش", description: "داده، گزارش یا کارهای پس‌زمینه", icon: "compute" },
      { value: "other", label: "چند سرویس / چیز دیگه", description: "با گفت‌وگو دقیق‌ترش می‌کنیم", icon: "support" },
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
    stepLabel: "وضعیت فعلی",
    prompt: "الان سرویس کجاست؟",
    helper: "هاست اشتراکی، VPS دیگر، لوکال یا هنوز ساخته‌نشده؛ همین کافی است.",
    explanation:
      "وضعیت فعلی کمک می‌کند برای شروع بیش‌ازحد نخری و در عین حال برای مصرف واقعی کم نیاوری.",
    example: "اگر روی هاست اشتراکی فعالی، همان را بگو؛ حتی اگر ترافیک هنوز کم است.",
    decisionEffect: "حاشیه‌ی منابع و نیاز به خدمت مهاجرت را تغییر می‌دهد.",
    unknownNote: "اگر هنوز ساخته نشده، «هنوز ساخته نشده» شروع امن‌تری است.",
    options: [
      { value: "idea", label: "هنوز ساخته نشده", description: "از صفر می‌خواهیم شروع کنیم", icon: "compute" },
      { value: "launch", label: "لوکال / آماده‌ی انتقال", description: "روی سیستم خودم یا نزدیک لانچ", icon: "growth" },
      { value: "active", label: "هاست اشتراکی", description: "الان روی هاست معمولی فعال است", icon: "traffic" },
      { value: "growing", label: "VPS یا سرور دیگر", description: "الان روی سرور جداگانه است", icon: "growth" },
      { value: "migration", label: "در حال مهاجرت", description: "باید بدون از دست رفتن سرویس جابه‌جا شود", icon: "support" },
    ],
  },
  usage: {
    id: "usage",
    stepLabel: "ترافیک",
    prompt: "ترافیک و کاربر هم‌زمان تقریباً چقدره؟",
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
    stepLabel: "دسترسی مهاجرت",
    prompt: "برای انتقال، دسترسی سورس یا سایت فعلی رو می‌تونی بدی؟",
    helper: "اگر آدرس، پنل یا سورس را بدهی، تیم ابرچین مسیر مهاجرت را دقیق‌تر می‌چیند.",
    explanation:
      "دسترسی به مبدأ مهاجرت مشخص می‌کند انتقال خدمت‌محور لازم است یا خرید سرور به‌تنهایی کافی است.",
    example: "لینک سایت، پنل هاست، یا ریپوی سورس؛ جزئیات محرمانه بعداً امن رد و بدل می‌شود.",
    decisionEffect: "مسیر همراهی مهاجرت و Cutover را فعال یا سبک می‌کند.",
    unknownNote: "قبل از اجرا دسترسی را جداگانه هماهنگ می‌کنیم.",
    options: [
      { value: "flexible", label: "بله، دسترسی می‌دم", description: "آدرس/پنل/سورس را در اختیار می‌گذارم", icon: "support" },
      { value: "short", label: "بعداً هماهنگ می‌کنم", description: "الان قطعی نیست ولی ممکن است", icon: "managed-shield" },
      { value: "near_zero", label: "بدون توقف باید منتقل شود", description: "Cutover حساس با حداقل قطعی", icon: "warning" },
      { value: "unknown", label: "هنوز مطمئن نیستم", description: "در گفت‌وگو بعدی روشن می‌کنیم", icon: "question-help" },
    ],
  },
  criticality: {
    id: "criticality",
    stepLabel: "زمان تحویل",
    prompt: "تحویل کی برات مهمه و اگر قطع بشه چقدر آسیب می‌بینه؟",
    helper: "هم فوریت راه‌اندازی و هم حساسیت قطعی را با هم می‌سنجیم.",
    explanation:
      "هرچه توقف پرهزینه‌تر یا تحویل فوری‌تر باشد، بکاپ، پایش و همراهی تحویل مهم‌تر می‌شود.",
    example: "لانچ فوری فروشگاه با وبلاگ شخصی که بعداً منتقل می‌شود فرق دارد.",
    decisionEffect: "روی پرچین، بکاپ پیشنهادی و اولویت صف تحویل اثر دارد.",
    unknownNote: "براساس نوع پروژه یک سطح محافظه‌کارانه انتخاب می‌کنیم و آن را قطعی جلوه نمی‌دهیم.",
    options: [
      { value: "low", label: "برنامه‌ریزی‌شده؛ قطعی کم‌اهمیت", description: "عجله نیست و توقف کوتاه قابل قبول است", icon: "backup" },
      { value: "medium", label: "به‌زودی؛ قطعی آزاردهنده", description: "زمان مهم است ولی بحرانی نیست", icon: "warning" },
      { value: "high", label: "فوری؛ فروش/کار می‌ایسته", description: "نیاز به تحویل سریع و مراقبت بیشتر", icon: "managed-shield" },
      { value: "severe", label: "فوری و حیاتی", description: "قطع شدن خسارت جدی دارد", icon: "warning" },
      { value: "unknown", label: "هنوز مشخص نیست", description: "با فرض قابل بازبینی جلو می‌رویم", icon: "support" },
    ],
  },
  management: {
    id: "management",
    stepLabel: "همراهی",
    prompt: "مدیریت و خدمات اضافه رو کی انجام بده؟",
    helper: "خودت، ابرچین، یا مشترک؛ پرچین سطح همراهی تحویل را مشخص می‌کند.",
    explanation:
      "پرچین شامل تحویل کنترل‌شده و دسترسی امن است. SSL، دامنه، بکاپ و مهاجرت به‌صورت خدمت جدا با Admin قیمت‌گذاری می‌شوند.",
    example: "اگر مهاجرت سایت می‌خواهی، مسیر همراه ابرچین مناسب‌تر است.",
    decisionEffect: "دامنه مسئولیت تحویل و خدمات قابل اتکا را شفاف می‌کند.",
    unknownNote: "همراه ابرچین انتخاب می‌شود و مسئولیت‌ها قبل از پرداخت نمایش داده می‌شوند.",
    options: [
      { value: "managed", label: "ابرچین همراهی کند", description: "پرچین + پیگیری تحویل و خدمت", icon: "managed-shield" },
      { value: "raw", label: "بیشتر خودم مدیریت می‌کنم", description: "سرور را می‌گیرم و خودم پیش می‌برم", icon: "raw-server" },
      { value: "unknown", label: "مشترک / راهنمایی می‌خوام", description: "با هم مرز مسئولیت را روشن می‌کنیم", icon: "support" },
    ],
  },
};

export function getRecommendationQuestionOrder(
  answers: RecommendationAnswers,
): QuestionId[] {
  // Conversational Compass core (Founder-approved topics), not a staged wizard.
  // Branch only when migration needs a source/access follow-up.
  const order: QuestionId[] = [
    "project",
    "stage",
    "usage",
    "criticality",
    "management",
  ];
  const migration =
    answers.project === "migration" || answers.stage === "migration";
  if (migration) {
    order.splice(2, 0, "downtime");
  }
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
