"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ConversationCloud } from "@/components/conversation-cloud";
import { QuickCloudPlans } from "@/components/quick-cloud-plans";
import {
  adjustRecommendationProfile,
  buildRecommendation,
} from "@/lib/recommendation/engine";
import {
  getDefaultAssistedAnswer,
  getRecommendationQuestion,
  getRecommendationQuestionOrder,
} from "@/lib/recommendation/questions";
import type {
  AnswerSources,
  ManagementKind,
  ProjectKind,
  PublicRecommendationQuote,
  QuestionId,
  RecommendationAnswers,
  RecommendationDirection,
} from "@/lib/recommendation/types";

const storageKey = "abrchin:conversation:v1";

const confidenceLabels = {
  high: "اطلاعات کافی",
  medium: "با چند فرض روشن",
  low: "پیشنهاد اولیه و قابل بازبینی",
} as const;

const backupLabels = {
  NONE: "نیاز الزامی ندارد",
  WEEKLY: "هفتگی پیشنهاد می‌شود",
  DAILY: "روزانه پیشنهاد می‌شود",
} as const;

type StoredDraft = {
  answers: RecommendationAnswers;
  sources: AnswerSources;
  stepIndex: number;
  showResult: boolean;
  direction: RecommendationDirection;
};

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<StoredDraft>;
  return Boolean(draft.answers && draft.sources && typeof draft.stepIndex === "number");
}

function selectedLabel(questionId: QuestionId, value: string, answers: RecommendationAnswers) {
  return getRecommendationQuestion(questionId, answers).options.find((option) => option.value === value)?.label;
}

export function ConversationBuilder({
  initialProject,
  initialManagement,
  resume = false,
  signedIn,
}: {
  initialProject?: ProjectKind;
  initialManagement?: Exclude<ManagementKind, "unknown">;
  resume?: boolean;
  signedIn: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [hydrated, setHydrated] = useState(!resume);
  const [answers, setAnswers] = useState<RecommendationAnswers>(
    {
      ...(initialProject ? { project: initialProject } : {}),
      ...(initialManagement ? { management: initialManagement } : {}),
    },
  );
  const [sources, setSources] = useState<AnswerSources>(
    {
      ...(initialProject ? { project: "user" as const } : {}),
      ...(initialManagement ? { management: "user" as const } : {}),
    },
  );
  const [stepIndex, setStepIndex] = useState(initialProject ? 1 : 0);
  const [showResult, setShowResult] = useState(false);
  const [direction, setDirection] = useState<RecommendationDirection>("balanced");
  const [helpOpen, setHelpOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [quotes, setQuotes] = useState<PublicRecommendationQuote[]>([]);
  const [quotesResolved, setQuotesResolved] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesNotice, setQuotesNotice] = useState<string | null>(null);
  const [quotesRetry, setQuotesRetry] = useState(0);
  const questionOrder = useMemo(() => getRecommendationQuestionOrder(answers), [answers]);

  useEffect(() => {
    if (!resume) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isStoredDraft(parsed)) {
          setAnswers(parsed.answers);
          setSources(parsed.sources);
          const restoredOrder = getRecommendationQuestionOrder(parsed.answers);
          setStepIndex(
            Math.max(0, Math.min(parsed.stepIndex, restoredOrder.length - 1)),
          );
          setShowResult(parsed.showResult);
          setDirection(parsed.direction ?? "balanced");
          setRestored(true);
        }
      } catch {
        window.sessionStorage.removeItem(storageKey);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [resume]);

  useEffect(() => {
    if (!hydrated) return;
    const draft: StoredDraft = { answers, sources, stepIndex, showResult, direction };
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }, [answers, direction, hydrated, showResult, sources, stepIndex]);

  useEffect(() => {
    if (!showResult) return;

    const controller = new AbortController();

    async function loadQuotes() {
      try {
        const response = await fetch("/api/recommendations/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, sources }),
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          quotes?: PublicRecommendationQuote[];
          quoteNotice?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "دریافت پیشنهادها ممکن نیست.");
        }
        setQuotes(body.quotes ?? []);
        setQuotesNotice(body.quoteNotice ?? null);
        setQuotesResolved(true);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setQuotes([]);
        setQuotesNotice(null);
        setQuotesResolved(true);
        setQuotesError(error instanceof Error ? error.message : "دریافت پیشنهادها ممکن نیست.");
      }
    }

    void loadQuotes();

    return () => controller.abort();
  }, [answers, quotesRetry, showResult, sources]);

  const questionId = questionOrder[Math.min(stepIndex, questionOrder.length - 1)];
  const question = getRecommendationQuestion(questionId, answers);
  const selected = answers[questionId] as string | undefined;
  const recommendation = useMemo(
    () => buildRecommendation(answers, sources),
    [answers, sources],
  );
  const activeProfile = useMemo(
    () => adjustRecommendationProfile(recommendation, direction),
    [direction, recommendation],
  );
  const completedAnswers = questionOrder
    .slice(0, stepIndex)
    .filter((id) => Boolean(answers[id]));
  const quotesLoading = showResult && !quotesResolved && quotesError === null;

  function choose(value: string, source: AnswerSources[QuestionId] = "user") {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setSources((current) => ({ ...current, [questionId]: source }));
    setQuotes([]);
    setQuotesResolved(false);
    setQuotesError(null);
    setQuotesNotice(null);
  }

  function helpMeChoose() {
    const value = getDefaultAssistedAnswer(questionId, answers);
    choose(value, "estimate");
    setHelpOpen(false);
  }

  function next() {
    if (!selected) return;
    if (stepIndex === questionOrder.length - 1) {
      setShowResult(true);
      return;
    }
    setStepIndex((current) => current + 1);
    setHelpOpen(false);
  }

  function back() {
    if (showResult) {
      setShowResult(false);
      return;
    }
    setStepIndex((current) => Math.max(0, current - 1));
    setHelpOpen(false);
  }

  function restart() {
    setAnswers({});
    setSources({});
    setStepIndex(0);
    setShowResult(false);
    setDirection("balanced");
    setHelpOpen(false);
    setRestored(false);
    setQuotes([]);
    setQuotesResolved(false);
    setQuotesError(null);
    setQuotesNotice(null);
    window.sessionStorage.removeItem(storageKey);
  }

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.42, ease: [0.2, 0.78, 0.24, 1] as const };

  if (!hydrated) {
    return (
      <section className="conversation-page page-view conversation-loading" aria-live="polite">
        <span className="conversation-loading-mark">
          <Image src="/assets/abrchin-symbol.svg" alt="" width={72} height={62} />
        </span>
        <p>داریم ادامه‌ی چینشت رو آماده می‌کنیم…</p>
      </section>
    );
  }

  return (
    <section className="conversation-page page-view" aria-labelledby="conversation-title">
      <header className="conversation-topline">
        <div>
          <span className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            گفت‌وگوی ساخت سرور
          </span>
          <h1 id="conversation-title">
            {showResult ? recommendation.title : "زیرساختت رو با هم می‌چینیم."}
          </h1>
          <p>
            {showResult
              ? "یک پیشنهاد اصلی، با دلیل و فرض‌های روشن."
              : "هرجا جواب فنی رو ندونی، همون‌جا برات ساده‌اش می‌کنیم."}
          </p>
        </div>

        <div className="conversation-progress" aria-label="پیشرفت مکالمه">
          <span>
            {showResult
              ? "پیشنهاد آماده"
              : `سؤال ${stepIndex + 1} از ${questionOrder.length}`}
          </span>
          <div>
            <motion.i
              initial={false}
              animate={{
                width: `${
                  showResult
                    ? 100
                    : ((stepIndex + (selected ? 1 : 0)) / questionOrder.length) * 100
                }%`,
              }}
              transition={transition}
            />
          </div>
        </div>
      </header>

      {restored ? (
        <div className="conversation-resume-note" role="status">
          <Check size={15} aria-hidden="true" />
          از همون‌جایی که بودی ادامه دادیم.
          <button type="button" onClick={() => setRestored(false)} aria-label="بستن پیام">
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="conversation-workspace">
        <main className="conversation-panel">
          <div className="conversation-thread" aria-label="خلاصه‌ی گفت‌وگو">
            <div className="thread-message thread-message--assistant">
              <span className="thread-avatar">
                <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
              </span>
              <p>
                {showResult
                  ? "نیازت رو جمع‌بندی کردم. این انتخاب اصلی منه؛ هر فرضی هم که زدم پایینش نوشته شده."
                  : question.helper}
              </p>
            </div>

            {completedAnswers.slice(-2).map((id) => {
              const value = answers[id] as string;
              return (
                <div className="thread-message thread-message--user" key={id}>
                  <small>{getRecommendationQuestion(id, answers).prompt}</small>
                  <strong>{selectedLabel(id, value, answers) ?? value}</strong>
                </div>
              );
            })}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {!showResult ? (
              <motion.div
                key={questionId}
                className="conversation-question-card"
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
                transition={transition}
              >
                <div className="question-meta">
                  <span>{question.stepLabel}</span>
                  <button type="button" onClick={() => setHelpOpen(true)}>
                    <Info size={15} aria-hidden="true" />
                    این یعنی چی؟
                  </button>
                </div>

                <h2>{question.prompt}</h2>
                <p>{question.helper}</p>

                <div className="conversation-options" role="radiogroup" aria-label={question.prompt}>
                  {question.options.map((option) => {
                    const active = selected === option.value;
                    return (
                      <motion.button
                        layout={!reduceMotion}
                        key={option.value}
                        type="button"
                        className={active ? "is-selected" : ""}
                        aria-pressed={active}
                        onClick={() =>
                          choose(
                            option.value,
                            option.value === "unknown" ? "estimate" : "user",
                          )
                        }
                      >
                        <span className="conversation-option-icon">
                          <Image
                            src={`/assets/abrchin-system/icons/${option.icon}.svg`}
                            alt=""
                            width={30}
                            height={30}
                          />
                        </span>
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        <i aria-hidden="true">{active ? <Check size={13} /> : null}</i>
                      </motion.button>
                    );
                  })}
                </div>

                <div className="question-actions">
                  <button className="question-assist" type="button" onClick={() => setHelpOpen(true)}>
                    <CircleHelp size={16} aria-hidden="true" />
                    کمکم کن انتخاب کنم
                  </button>
                  <div>
                    {stepIndex > 0 ? (
                      <button className="button button-quiet" type="button" onClick={back}>
                        <ArrowRight size={17} aria-hidden="true" />
                        قبلی
                      </button>
                    ) : null}
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={!selected}
                      onClick={next}
                    >
                      {stepIndex === questionOrder.length - 1
                        ? "پیشنهاد رو بساز"
                        : "ادامه"}
                      <ArrowLeft size={17} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="result"
                className="conversation-result-card"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transition}
              >
                <div className="result-recommendation-head">
                  <div>
                    <span>
                      <Check size={14} aria-hidden="true" />
                      پیشنهاد اصلی ابرچین
                    </span>
                    <h2>{recommendation.workloadLabel}</h2>
                    <p>{recommendation.summary}</p>
                  </div>
                  <span className={`confidence confidence--${recommendation.confidence}`}>
                    {confidenceLabels[recommendation.confidence]}
                  </span>
                </div>

                <div className="result-direction" aria-label="تنظیم جهت پیشنهاد">
                  {(
                    [
                      ["economy", "ارزان‌ترش کن"],
                      ["balanced", "متعادل"],
                      ["performance", "قوی‌ترش کن"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={direction === value ? "is-active" : ""}
                      onClick={() => setDirection(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="recommendation-resources">
                  <span>
                    <small>پردازنده</small>
                    <strong dir="ltr">{activeProfile.vcpu} vCPU</strong>
                  </span>
                  <span>
                    <small>حافظه</small>
                    <strong dir="ltr">{activeProfile.ramGb} GB RAM</strong>
                  </span>
                  <span>
                    <small>فضای اولیه</small>
                    <strong dir="ltr">{activeProfile.storageGb} GB</strong>
                  </span>
                  <span>
                    <small>تحویل</small>
                    <strong>
                      {activeProfile.deliveryMode === "MANAGED" ? "همراه ابرچین" : "سرور خام"}
                    </strong>
                  </span>
                  <span>
                    <small>نیاز بکاپ</small>
                    <strong>{backupLabels[activeProfile.backupPolicy]}</strong>
                  </span>
                </div>

                <details className="recommendation-details">
                  <summary>
                    چرا این پیشنهاد؟
                    <ChevronDown size={15} aria-hidden="true" />
                  </summary>
                  <ul>
                    {recommendation.reasons.slice(0, 4).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </details>

                {recommendation.assumptions.length > 0 ? (
                  <details className="recommendation-details recommendation-details--assumptions">
                    <summary>
                      فرض‌های قابل تغییر ({recommendation.assumptions.length})
                      <ChevronDown size={15} aria-hidden="true" />
                    </summary>
                    <ul>
                      {recommendation.assumptions.map((assumption) => (
                        <li key={assumption.field}>
                          <strong>{assumption.label}: </strong>
                          {assumption.value} — {assumption.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {recommendation.caveats.map((caveat) => (
                  <div className="recommendation-caveat" key={caveat}>
                    <ShieldCheck size={18} aria-hidden="true" />
                    <p>{caveat}</p>
                  </div>
                ))}

                <div className="result-live-plans">
                  <div>
                    <span>سه چینش واقعی ابرچین</span>
                    <strong>
                      {quotes.length >= 3
                        ? "قیمت‌های فروش تأیید شده‌اند"
                        : quotesLoading
                          ? "در حال بررسی قیمت و ظرفیت واقعی"
                          : "ظرفیت‌های معتبر موجود نمایش داده شده‌اند"}
                    </strong>
                  </div>
                  {quotesError ? (
                    <section className="quick-plans-empty" role="alert">
                      <CircleHelp size={24} aria-hidden="true" />
                      <div>
                        <strong>{quotesError}</strong>
                        <button
                          className="button button-quiet"
                          type="button"
                          onClick={() => {
                            setQuotesError(null);
                            setQuotes([]);
                            setQuotesResolved(false);
                            setQuotesNotice(null);
                            setQuotesRetry((current) => current + 1);
                          }}
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          تلاش دوباره
                        </button>
                      </div>
                    </section>
                  ) : quotesLoading ? (
                    <section className="quick-plans-empty" aria-live="polite">
                      <RefreshCw className="spin" size={24} aria-hidden="true" />
                      <div>
                        <strong>قیمت، ظرفیت و تناسب چینش‌ها در حال بررسی است.</strong>
                        <p>فقط پیشنهادهای قابل خرید وارد مقایسه می‌شوند.</p>
                      </div>
                    </section>
                  ) : quotes.length === 0 && quotesNotice ? (
                    <section className="quick-plans-empty" role="status">
                      <ShieldCheck size={24} aria-hidden="true" />
                      <div>
                        <strong>{quotesNotice}</strong>
                        <p>
                          می‌تونی یک پاسخ را تغییر بدهی یا با همراهی ابرچین ادامه بدهی.
                        </p>
                      </div>
                    </section>
                  ) : (
                    <>
                      {quotesNotice ? (
                        <div className="recommendation-caveat">
                          <CircleHelp size={18} aria-hidden="true" />
                          <p>{quotesNotice}</p>
                        </div>
                      ) : null}
                      <QuickCloudPlans quotes={quotes} signedIn={signedIn} compact />
                    </>
                  )}
                </div>

                <div className="conversation-result-actions">
                  <button className="button button-quiet" type="button" onClick={back}>
                    <ArrowRight size={17} aria-hidden="true" />
                    یک چیز رو عوض کنیم
                  </button>
                  {recommendation.architectureEscalation ? (
                    <Link className="button button-primary" href="/help">
                      با همراهی ادامه بده
                      <ArrowLeft size={17} aria-hidden="true" />
                    </Link>
                  ) : (
                    <Link className="button button-primary" href="/cloud-servers">
                      همه سرورهای آماده
                      <ArrowLeft size={17} aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <ConversationCloud
          step={stepIndex}
          profile={activeProfile}
          direction={direction}
          complete={showResult}
        />
      </div>

      <AnimatePresence>
        {helpOpen ? (
          <motion.div
            className="question-help-layer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-help-title"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setHelpOpen(false);
            }}
          >
            <motion.div
              className="question-help-sheet"
              initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.99 }}
              transition={transition}
            >
              <button
                className="question-help-close"
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="بستن راهنما"
              >
                <X size={18} />
              </button>
              <span className="eyebrow">
                <Info size={14} aria-hidden="true" />
                توضیح همین سؤال
              </span>
              <h2 id="question-help-title">{question.prompt}</h2>
              <p>{question.explanation}</p>
              <dl>
                <div>
                  <dt>یک مثال</dt>
                  <dd>{question.example}</dd>
                </div>
                <div>
                  <dt>اثر انتخاب</dt>
                  <dd>{question.decisionEffect}</dd>
                </div>
                <div>
                  <dt>اگر ندونی</dt>
                  <dd>{question.unknownNote}</dd>
                </div>
              </dl>
              <div className="question-help-actions">
                <button className="button button-quiet" type="button" onClick={() => setHelpOpen(false)}>
                  خودم انتخاب می‌کنم
                </button>
                <button className="button button-primary" type="button" onClick={helpMeChoose}>
                  <CircleHelp size={16} aria-hidden="true" />
                  ابرچین پیشنهاد بده
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {showResult ? (
        <button className="conversation-restart" type="button" onClick={restart}>
          <RefreshCw size={14} aria-hidden="true" />
          شروع یک گفت‌وگوی تازه
        </button>
      ) : null}
    </section>
  );
}
