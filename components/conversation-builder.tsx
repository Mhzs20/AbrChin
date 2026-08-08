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
import { useEffect, useMemo, useRef, useState } from "react";

import { ConversationCloud } from "@/components/conversation-cloud";
import { QuickCloudPlans } from "@/components/quick-cloud-plans";
import {
  generateCustomerServerName,
  isValidCustomerServerName,
} from "@/lib/infrastructure/image-identity";
import {
  parchinLevelRank,
  parchinLevels,
  recommendedParchinLevel,
} from "@/lib/parchin/recommendation";
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
  ProjectKind,
  PublicRecommendationQuote,
  QuestionId,
  RecommendationAnswers,
  RecommendationDirection,
} from "@/lib/recommendation/types";
import type { ParchinLevel } from "@prisma/client";

import type { ParchinLevelLabels } from "@/lib/parchin/labels";
import {
  defaultParchinLevelLabels,
  resolveParchinLevelLabel,
} from "@/lib/parchin/labels";

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
  sessionId?: string;
  revision?: number;
  answers: RecommendationAnswers;
  sources: AnswerSources;
  stepIndex: number;
  showResult: boolean;
  showUnderstanding: boolean;
  understandingConfirmed: boolean;
  showComparisons: boolean;
  direction: RecommendationDirection;
  parchinLevel?: ParchinLevel;
  deliveryConfigured?: boolean;
};

type ResumedConversation = {
  sessionId: string;
  revision: number;
  productFlowState: string;
  answers: RecommendationAnswers;
  answerSources: AnswerSources;
  understandingSnapshot?: unknown;
  selectedParchinLevel?: ParchinLevel | null;
};

type DeliveryOption = {
  id: string;
  role: "RECOMMENDED" | "ECONOMY" | "GROWTH";
  region: string;
  title: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  images: Array<{
    id: string;
    label: string;
    displayName?: string;
    windows: boolean;
  }>;
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
  parchinLabels: parchinLabelsProp,
}: {
  initialProject?: ProjectKind;
  initialManagement?: "managed";
  resume?: boolean;
  signedIn: boolean;
  parchinLabels?: ParchinLevelLabels;
}) {
  const parchinLabels = parchinLabelsProp ?? defaultParchinLevelLabels();
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
  const [stepIndex, setStepIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [showUnderstanding, setShowUnderstanding] = useState(false);
  const [understandingConfirmed, setUnderstandingConfirmed] = useState(false);
  const [showComparisons, setShowComparisons] = useState(false);
  const [direction, setDirection] = useState<RecommendationDirection>("balanced");
  const [requestedParchinLevel, setRequestedParchinLevel] =
    useState<ParchinLevel>("PARCHIN_START");
  const [helpOpen, setHelpOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [quotes, setQuotes] = useState<PublicRecommendationQuote[]>([]);
  const [quotesResolved, setQuotesResolved] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesNotice, setQuotesNotice] = useState<string | null>(null);
  const [quotesRetry, setQuotesRetry] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [deliveryOptionsResolved, setDeliveryOptionsResolved] =
    useState(false);
  const [selectedDeliveryPlanId, setSelectedDeliveryPlanId] =
    useState("");
  const [selectedImageAssetId, setSelectedImageAssetId] = useState("");
  const [accessMethod, setAccessMethod] = useState<
    "ONE_TIME_PASSWORD" | "SSH_KEY" | "WINDOWS_PASSWORD"
  >("ONE_TIME_PASSWORD");
  const [serverName, setServerName] = useState("");
  const [serverNameTouched, setServerNameTouched] = useState(false);
  const [deliveryConfigured, setDeliveryConfigured] = useState(false);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryRetry, setDeliveryRetry] = useState(0);
  const autoDeliveryAttempted = useRef(false);
  const [termMonths, setTermMonths] = useState<1 | 3 | 6 | 12>(1);
  const [couponCode, setCouponCode] = useState("");
  const [servicePackages, setServicePackages] = useState<
    Array<{
      code: string;
      title: string;
      description: string;
      priceRial: string;
      priceTomanFa: string;
    }>
  >([]);
  const [serviceRequesting, setServiceRequesting] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const questionOrder = useMemo(() => getRecommendationQuestionOrder(answers), [answers]);
  const minimumParchinLevel = recommendedParchinLevel(answers);
  const selectedParchinLevel =
    parchinLevelRank(requestedParchinLevel) <
    parchinLevelRank(minimumParchinLevel)
      ? minimumParchinLevel
      : requestedParchinLevel;

  useEffect(() => {
    if (!resume) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        let cached: StoredDraft | null = null;
        let cachedSessionId: string | null = null;
        try {
          const raw = window.sessionStorage.getItem(storageKey);
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          if (isStoredDraft(parsed)) {
            cached = parsed;
            cachedSessionId = parsed.sessionId ?? null;
          }
        } catch {
          window.sessionStorage.removeItem(storageKey);
        }

        let databaseSession: ResumedConversation | null = null;
        try {
          const response = await fetch("/api/recommendations/sessions", {
            signal: controller.signal,
          });
          if (response.ok) {
            const body = (await response.json()) as {
              session?: ResumedConversation | null;
            };
            databaseSession = body.session ?? null;
          }
          if (!databaseSession && cachedSessionId) {
            const cachedResponse = await fetch(
              `/api/recommendations/sessions/${cachedSessionId}`,
              { signal: controller.signal },
            );
            if (cachedResponse.ok) {
              const body = (await cachedResponse.json()) as {
                session?: ResumedConversation | null;
              };
              databaseSession = body.session ?? null;
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }

        if (databaseSession) {
          const restoredAnswers = {
            ...databaseSession.answers,
            management:
              databaseSession.answers.management === "raw"
                ? "managed"
                : databaseSession.answers.management,
          };
          setAnswers(restoredAnswers);
          setSources(databaseSession.answerSources);
          setSessionId(databaseSession.sessionId);
          setRevision(databaseSession.revision);
          const restoredOrder =
            getRecommendationQuestionOrder(restoredAnswers);
          const firstMissing = restoredOrder.findIndex(
            (questionId) => !restoredAnswers[questionId],
          );
          setStepIndex(
            firstMissing < 0
              ? Math.max(0, restoredOrder.length - 1)
              : firstMissing,
          );
          const state = databaseSession.productFlowState;
          if (state === "DRAFT") {
            setUnderstandingConfirmed(false);
            setShowUnderstanding(Boolean(restoredAnswers.project));
            setShowResult(false);
            setDeliveryConfigured(false);
          } else {
            setUnderstandingConfirmed(true);
            setShowUnderstanding(false);
            setShowResult(
              [
                "REQUIREMENTS_COMPLETE",
                "RECOMMENDED",
                "PARCHIN_SELECTED",
                "DELIVERY_CONFIGURED",
                "QUOTED",
                "QUOTE_EXPIRED",
              ].includes(state),
            );
            setDeliveryConfigured(
              ["DELIVERY_CONFIGURED", "QUOTED", "QUOTE_EXPIRED"].includes(
                state,
              ),
            );
          }
          if (
            databaseSession.selectedParchinLevel &&
            parchinLevels.includes(databaseSession.selectedParchinLevel)
          ) {
            setRequestedParchinLevel(
              databaseSession.selectedParchinLevel,
            );
          }
          setRestored(true);
        } else if (cached) {
          // Answers/sources may restore locally, but flow gates must follow
          // server state. Cached understanding/result/delivery can desync to a
          // DRAFT session and blank Compass delivery/quotes.
          setAnswers(cached.answers);
          setSources(cached.sources);
          const restoredOrder = getRecommendationQuestionOrder(
            cached.answers,
          );
          const firstMissing = restoredOrder.findIndex(
            (questionId) => !cached.answers[questionId],
          );
          setStepIndex(
            firstMissing < 0
              ? 0
              : Math.max(0, Math.min(firstMissing, restoredOrder.length - 1)),
          );
          setShowResult(false);
          setShowUnderstanding(Boolean(cached.answers.project));
          setUnderstandingConfirmed(false);
          setShowComparisons(cached.showComparisons ?? false);
          setDirection(cached.direction ?? "balanced");
          setDeliveryConfigured(false);
          if (
            cached.parchinLevel &&
            parchinLevels.includes(cached.parchinLevel)
          ) {
            setRequestedParchinLevel(cached.parchinLevel);
          }
          setSessionId(null);
          setRevision(0);
          setRestored(true);
        }
        setHydrated(true);
      })();
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [resume, signedIn]);

  useEffect(() => {
    if (!hydrated || sessionId) return;
    const controller = new AbortController();
    void fetch("/api/recommendations/sessions", {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          sessionId?: string;
          revision?: number;
        };
        if (body.sessionId) {
          setSessionId(body.sessionId);
          setRevision(body.revision ?? 0);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [hydrated, sessionId]);

  useEffect(() => {
    if (!hydrated) return;
    const draft: StoredDraft = {
      sessionId: sessionId ?? undefined,
      revision,
      answers,
      sources,
      stepIndex,
      showResult,
      showUnderstanding,
      understandingConfirmed,
      showComparisons,
      direction,
      parchinLevel: selectedParchinLevel,
      deliveryConfigured,
    };
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }, [
    answers,
    direction,
    deliveryConfigured,
    hydrated,
    revision,
    sessionId,
    selectedParchinLevel,
    showComparisons,
    showResult,
    showUnderstanding,
    sources,
    stepIndex,
    understandingConfirmed,
  ]);

  useEffect(() => {
    if (!showResult || !deliveryConfigured) return;

    const controller = new AbortController();

    async function loadQuotes() {
      try {
        const response = await fetch("/api/recommendations/quotes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            answers,
            sources,
            sessionId,
            includeComparisons: showComparisons,
            parchinLevel: selectedParchinLevel,
            termMonths,
            couponCode: couponCode.trim() || null,
          }),
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          quotes?: PublicRecommendationQuote[];
          quoteNotice?: string | null;
          servicePackages?: Array<{
            code: string;
            title: string;
            description: string;
            priceRial: string;
            priceTomanFa: string;
          }>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "دریافت پیشنهادها ممکن نیست.");
        }
        setQuotes(body.quotes ?? []);
        setQuotesNotice(body.quoteNotice ?? null);
        setServicePackages(body.servicePackages ?? []);
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
  }, [
    answers,
    couponCode,
    quotesRetry,
    sessionId,
    selectedParchinLevel,
    showComparisons,
    showResult,
    sources,
    deliveryConfigured,
    termMonths,
  ]);

  useEffect(() => {
    if (
      !showResult ||
      deliveryConfigured ||
      !sessionId ||
      deliveryOptionsResolved
    ) {
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/recommendations/sessions/${sessionId}/delivery?parchinLevel=${selectedParchinLevel}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          options?: DeliveryOption[];
          revision?: number;
          defaultServerName?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            body.error ?? "گزینه‌های تحویل در دسترس نیستند.",
          );
        }
        const options = body.options ?? [];
        setDeliveryOptions(options);
        setRevision(body.revision ?? revision);
        const preferred =
          options.find((option) => option.role === "RECOMMENDED") ??
          options[0];
        setSelectedDeliveryPlanId(preferred?.id ?? "");
        const image =
          preferred?.images.find((item) => !item.windows) ??
          preferred?.images[0];
        setSelectedImageAssetId(image?.id ?? "");
        setAccessMethod(
          image?.windows ? "WINDOWS_PASSWORD" : "ONE_TIME_PASSWORD",
        );
        setServerName(
          body.defaultServerName || generateCustomerServerName(),
        );
        setServerNameTouched(false);
        setQuotesError(null);
        setDeliveryOptionsResolved(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "گزینه‌های تحویل در دسترس نیستند.";
        setQuotesError(message);
        setDeliveryOptions([]);
        setDeliveryOptionsResolved(true);
        if (message.includes("برداشت ابرچین")) {
          setUnderstandingConfirmed(false);
          setShowResult(false);
          setShowUnderstanding(true);
        }
      });
    return () => controller.abort();
  }, [
    deliveryConfigured,
    deliveryOptionsResolved,
    deliveryRetry,
    revision,
    selectedParchinLevel,
    sessionId,
    showResult,
  ]);

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
  const completedAnswers = questionOrder.filter((id, index) => {
    if (!answers[id]) return false;
    if (showResult) return true;
    if (showUnderstanding) return index === 0;
    return index < stepIndex;
  });
  const quotesLoading =
    showResult &&
    deliveryConfigured &&
    !quotesResolved &&
    quotesError === null;
  const selectedDeliveryOption = deliveryOptions.find(
    (option) => option.id === selectedDeliveryPlanId,
  );
  const selectedDeliveryImage = selectedDeliveryOption?.images.find(
    (image) => image.id === selectedImageAssetId,
  );

  async function ensureSession() {
    if (sessionId) return { id: sessionId, nextRevision: revision };
    const response = await fetch("/api/recommendations/sessions", {
      method: "POST",
    });
    if (!response.ok) throw new Error("conversation_session_not_ready");
    const body = (await response.json()) as {
      sessionId?: string;
      revision?: number;
    };
    if (!body.sessionId) throw new Error("conversation_session_not_ready");
    setSessionId(body.sessionId);
    setRevision(body.revision ?? 0);
    return { id: body.sessionId, nextRevision: body.revision ?? 0 };
  }

  async function persistAnswer(
    id: QuestionId,
    value: string,
    source: AnswerSources[QuestionId] = "user",
  ) {
    const session = await ensureSession();
    const response = await fetch(
      `/api/recommendations/sessions/${session.id}/answers`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          questionId: id,
          answer: value,
          expectedRevision: session.nextRevision,
          source: source ?? "user",
        }),
      },
    );
    const body = (await response.json()) as {
      revision?: number;
      current?: ResumedConversation | null;
      error?: string;
    };
    if (response.status === 409 && body.current) {
      setAnswers(body.current.answers);
      setSources(body.current.answerSources);
      setRevision(body.current.revision);
      throw new Error("conversation_revision_conflict");
    }
    if (!response.ok) {
      throw new Error(body.error ?? "conversation_answer_not_saved");
    }
    setRevision(body.revision ?? session.nextRevision + 1);
  }

  function choose(value: string, source: AnswerSources[QuestionId] = "user") {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setSources((current) => ({ ...current, [questionId]: source }));
    setQuotes([]);
    setQuotesResolved(false);
    setQuotesError(null);
    setQuotesNotice(null);
    setDeliveryConfigured(false);
    setDeliveryOptions([]);
    setDeliveryOptionsResolved(false);
    autoDeliveryAttempted.current = false;
    if (questionId === "project") {
      setUnderstandingConfirmed(false);
    }
  }

  function helpMeChoose() {
    const value = getDefaultAssistedAnswer(questionId, answers);
    void reply(value, "estimate");
    setHelpOpen(false);
  }

  function chooseUnknown() {
    const explicitUnknown = question.options.find(
      (option) => option.value === "unknown",
    );
    void reply(
      explicitUnknown?.value ??
        getDefaultAssistedAnswer(questionId, answers),
      "estimate",
    );
  }

  async function reply(
    value: string,
    source: AnswerSources[QuestionId] = "user",
  ) {
    if (!value || savingAnswer) return;
    choose(value, source);
    setSavingAnswer(true);
    try {
      await persistAnswer(questionId, value, source);
      if (stepIndex === 0 && !understandingConfirmed) {
        setShowUnderstanding(true);
      } else if (stepIndex === questionOrder.length - 1) {
        setShowResult(true);
      } else {
        setStepIndex((current) => current + 1);
        setHelpOpen(false);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "conversation_revision_conflict"
      ) {
        setQuotesError("گفتگو هم‌زمان تغییر کرده؛ گزینه‌ات را یک‌بار دیگر بزن.");
      } else if (
        error instanceof Error &&
        error.message === "conversation_session_not_ready"
      ) {
        setQuotesError("نشست گفتگو هنوز آماده نیست؛ دوباره تلاش کن.");
      } else {
        setQuotesError(
          error instanceof Error && error.message && !error.message.startsWith("conversation_")
            ? error.message
            : "ذخیرهٔ پاسخ کامل نشد؛ دوباره تلاش کن.",
        );
      }
    } finally {
      setSavingAnswer(false);
    }
  }

  async function confirmUnderstanding() {
    if (!sessionId || !answers.project) return;
    setSavingAnswer(true);
    try {
      const response = await fetch(
        `/api/recommendations/sessions/${sessionId}/understanding`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision: revision,
            understanding: {
              project: answers.project,
              label:
                selectedLabel("project", answers.project, answers) ??
                answers.project,
              version: 1,
            },
          }),
        },
      );
      const body = (await response.json()) as {
        revision?: number;
        current?: ResumedConversation | null;
      };
      if (response.status === 409 && body.current) {
        setAnswers(body.current.answers);
        setSources(body.current.answerSources);
        setRevision(body.current.revision);
        throw new Error("conversation_revision_conflict");
      }
      if (!response.ok) throw new Error("understanding_not_saved");
      setRevision(body.revision ?? revision + 1);
      setUnderstandingConfirmed(true);
      setShowUnderstanding(false);
      setStepIndex(1);
      setQuotesError(null);
    } catch {
      setQuotesError("تأیید برداشت ذخیره نشد؛ دوباره تلاش کن.");
    } finally {
      setSavingAnswer(false);
    }
  }

  function back() {
    if (showResult) {
      setShowResult(false);
      return;
    }
    if (showUnderstanding) {
      setShowUnderstanding(false);
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
    setShowUnderstanding(false);
    setUnderstandingConfirmed(false);
    setShowComparisons(false);
    setDirection("balanced");
    setHelpOpen(false);
    setRestored(false);
    setQuotes([]);
    setQuotesResolved(false);
    setQuotesError(null);
    setQuotesNotice(null);
    setSessionId(null);
    setRevision(0);
    setDeliveryOptions([]);
    setDeliveryOptionsResolved(false);
    setSelectedDeliveryPlanId("");
    setSelectedImageAssetId("");
    setAccessMethod("ONE_TIME_PASSWORD");
    setServerName("");
    setServerNameTouched(false);
    setDeliveryConfigured(false);
    autoDeliveryAttempted.current = false;
    setDeliveryRetry(0);
    window.sessionStorage.removeItem(storageKey);
  }

  async function confirmDeliveryWith(input: {
    planId: string;
    imageAssetId: string;
    accessMethod: "ONE_TIME_PASSWORD" | "SSH_KEY" | "WINDOWS_PASSWORD";
    serverName?: string;
    /** Mirror the auto-picked selection into the form controls. */
    syncSelection?: boolean;
  }) {
    if (!sessionId || !input.planId || !input.imageAssetId) {
      setQuotesError("یک موقعیت، سرور و سیستم‌عامل معتبر انتخاب کن.");
      return;
    }
    const nextServerName = input.serverName ?? serverName;
    if (!isValidCustomerServerName(nextServerName)) {
      setQuotesError("نام سرور معتبر نیست.");
      return;
    }
    if (input.accessMethod === "SSH_KEY") {
      setQuotesError("انتخاب کلید SSH فعلاً برای خرید مستقیم در دسترس نیست.");
      return;
    }
    if (input.syncSelection) {
      setSelectedDeliveryPlanId(input.planId);
      setSelectedImageAssetId(input.imageAssetId);
      setAccessMethod(input.accessMethod);
      setServerName(nextServerName);
    }
    setSavingDelivery(true);
    setQuotesError(null);
    try {
      const response = await fetch(
        `/api/recommendations/sessions/${sessionId}/delivery`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: revision,
            planId: input.planId,
            imageAssetId: input.imageAssetId,
            parchinLevel: selectedParchinLevel,
            accessMethod: input.accessMethod,
            serverName: nextServerName.trim(),
            sshKeyName: null,
          }),
        },
      );
      const body = (await response.json()) as {
        revision?: number;
        current?: ResumedConversation | null;
        error?: string;
      };
      if (response.status === 409 && body.current) {
        setRevision(body.current.revision);
        throw new Error(
          "گفتگو در جای دیگری تغییر کرده؛ تنظیمات را دوباره بررسی کن.",
        );
      }
      if (!response.ok) {
        throw new Error(body.error ?? "ثبت تنظیمات تحویل ممکن نیست.");
      }
      setRevision(body.revision ?? revision + 1);
      setDeliveryConfigured(true);
      setQuotes([]);
      setQuotesResolved(false);
      setQuotesNotice(null);
    } catch (error: unknown) {
      setQuotesError(
        error instanceof Error
          ? error.message
          : "ثبت تنظیمات تحویل ممکن نیست.",
      );
      autoDeliveryAttempted.current = false;
    } finally {
      setSavingDelivery(false);
    }
  }

  async function confirmDelivery() {
    await confirmDeliveryWith({
      planId: selectedDeliveryPlanId,
      imageAssetId: selectedImageAssetId,
      accessMethod,
      serverName,
    });
  }

  useEffect(() => {
    if (
      !showResult ||
      deliveryConfigured ||
      !deliveryOptionsResolved ||
      autoDeliveryAttempted.current
    ) {
      return;
    }
    const preferred =
      deliveryOptions.find((option) => option.role === "RECOMMENDED") ??
      deliveryOptions[0];
    const image =
      preferred?.images.find((item) => !item.windows) ??
      preferred?.images[0];
    if (!preferred?.id || !image?.id) return;
    autoDeliveryAttempted.current = true;
    const nextAccess = image.windows
      ? "WINDOWS_PASSWORD"
      : "ONE_TIME_PASSWORD";
    const nextNameSeed = generateCustomerServerName();
    queueMicrotask(() => {
      setSelectedDeliveryPlanId(preferred.id);
      setSelectedImageAssetId(image.id);
      setAccessMethod(nextAccess);
      setServerName((current) =>
        current && isValidCustomerServerName(current)
          ? current
          : nextNameSeed,
      );
      setServerNameTouched(false);
    });
  }, [
    deliveryConfigured,
    deliveryOptions,
    deliveryOptionsResolved,
    showResult,
  ]);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.42, ease: [0.2, 0.78, 0.24, 1] as const };
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [
    completedAnswers.length,
    questionId,
    reduceMotion,
    showUnderstanding,
    showResult,
    savingAnswer,
  ]);

  if (!hydrated) {
    return (
      <section className="conversation-page page-view conversation-loading" aria-live="polite">
        <span className="conversation-loading-mark">
          <Image src="/assets/abrchin-symbol.svg" alt="" width={72} height={62} />
        </span>
        <p>داریم ادامه‌ی گفت‌وگو رو آماده می‌کنیم…</p>
      </section>
    );
  }

  return (
    <section className="conversation-page page-view" aria-labelledby="conversation-title">
      <header className="conversation-topline">
        <div>
          <span className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            قطب‌نمای ابرچین
          </span>
          <h1 id="conversation-title">
            {showResult ? recommendation.title : "با هم حرف می‌زنیم و مسیرت را می‌چینیم."}
          </h1>
          <p>
            {showResult
              ? "جمع‌بندی گفت‌وگو با پیشنهاد خدمت و سرور مناسب."
              : "مثل یک گفت‌وگوی کوتاه پاسخ بده؛ هر جواب، پیشنهاد را دقیق‌تر می‌کند."}
          </p>
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
          <div className="conversation-thread" aria-label="گفت‌وگوی قطب‌نما">
            <div className="thread-message thread-message--assistant">
              <span className="thread-avatar">
                <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
              </span>
              <div className="thread-bubble">
                <p>
                  سلام — من قطب‌نمای ابرچینم. بگو چی می‌خوای بسازی یا منتقل کنی تا
                  خدمت و سرور مناسب را پیشنهاد بدهم.
                </p>
              </div>
            </div>

            {completedAnswers.map((id) => {
              const value = answers[id] as string;
              const asked = getRecommendationQuestion(id, answers);
              return (
                <div className="thread-turn" key={id}>
                  <div className="thread-message thread-message--assistant">
                    <span className="thread-avatar">
                      <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
                    </span>
                    <div className="thread-bubble">
                      <p>{asked.prompt}</p>
                    </div>
                  </div>
                  <div className="thread-message thread-message--user">
                    <strong>{selectedLabel(id, value, answers) ?? value}</strong>
                  </div>
                </div>
              );
            })}

            {!showResult && !showUnderstanding ? (
              <div className="thread-turn thread-turn--active">
                <div className="thread-message thread-message--assistant">
                  <span className="thread-avatar">
                    <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
                  </span>
                  <div className="thread-bubble">
                    <p>{question.prompt}</p>
                    <small>{question.helper}</small>
                  </div>
                </div>
                <div
                  className="conversation-options conversation-options--chat"
                  role="radiogroup"
                  aria-label={question.prompt}
                >
                  {question.options.map((option) => {
                    const active = selected === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? "is-selected" : ""}
                        aria-pressed={active}
                        disabled={savingAnswer}
                        onClick={() =>
                          void reply(
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
                      </button>
                    );
                  })}
                </div>
                <div className="question-actions question-actions--chat">
                  <div>
                    <button
                      className="question-assist"
                      type="button"
                      disabled={savingAnswer}
                      onClick={chooseUnknown}
                    >
                      نمی‌دانم
                    </button>
                    <button
                      className="question-assist"
                      type="button"
                      onClick={() => setHelpOpen(true)}
                    >
                      <CircleHelp size={16} aria-hidden="true" />
                      این یعنی چی؟
                    </button>
                  </div>
                  {stepIndex > 0 ? (
                    <button className="button button-quiet" type="button" onClick={back}>
                      <ArrowRight size={17} aria-hidden="true" />
                      برگشت در گفت‌وگو
                    </button>
                  ) : null}
                </div>
                {quotesError ? <p className="product-error">{quotesError}</p> : null}
              </div>
            ) : null}

            {showUnderstanding ? (
              <div className="thread-turn thread-turn--active">
                <div className="thread-message thread-message--assistant">
                  <span className="thread-avatar">
                    <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
                  </span>
                  <div className="thread-bubble">
                    <p>
                      برداشت من اینه که برای «
                      {answers.project
                        ? selectedLabel("project", answers.project, answers)
                        : "نیازت"}
                      » می‌خوای ادامه بدیم. درست می‌گم؟
                    </p>
                  </div>
                </div>
                <div className="conversation-options conversation-options--chat">
                  <button
                    type="button"
                    disabled={savingAnswer}
                    onClick={() => void confirmUnderstanding()}
                  >
                    <span>
                      <strong>بله، درسته</strong>
                      <small>ادامه گفت‌وگو</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={savingAnswer}
                    onClick={() => {
                      setUnderstandingConfirmed(false);
                      setShowUnderstanding(false);
                      setStepIndex(0);
                    }}
                  >
                    <span>
                      <strong>نه، اصلاح می‌کنم</strong>
                      <small>برمی‌گردیم به هدف</small>
                    </span>
                  </button>
                </div>
                {quotesError ? <p className="product-error">{quotesError}</p> : null}
              </div>
            ) : null}

            {showResult ? (
              <div className="thread-message thread-message--assistant">
                <span className="thread-avatar">
                  <Image src="/assets/abrchin-symbol.svg" alt="" width={30} height={26} />
                </span>
                <div className="thread-bubble">
                  <p>
                    نیازت رو جمع‌بندی کردم. این پیشنهاد اصلیه؛ فرض‌ها و مسیر خدمت
                    پایین همین گفت‌وگوست.
                  </p>
                </div>
              </div>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {showResult ? (
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
                  <button
                    type="button"
                    className={showComparisons ? "is-active" : ""}
                    onClick={() => {
                      setShowComparisons((current) => !current);
                      setDirection("balanced");
                      setQuotesResolved(false);
                      setQuotesError(null);
                    }}
                  >
                    {showComparisons
                      ? "بستن مقایسهٔ اختیاری"
                      : "مقایسه با اقتصادی‌تر و قوی‌تر"}
                  </button>
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
                      همراه ابرچین
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

                <div className="result-direction" aria-label="انتخاب سطح پرچین">
                  <span>
                    حداقل پیشنهادی:{" "}
                    {resolveParchinLevelLabel(
                      minimumParchinLevel,
                      parchinLabels,
                    )}
                  </span>
                  {parchinLevels
                    .filter(
                      (level) =>
                        parchinLevelRank(level) >=
                        parchinLevelRank(minimumParchinLevel),
                    )
                    .map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={
                          selectedParchinLevel === level ? "is-active" : ""
                        }
                        onClick={() => {
                          setRequestedParchinLevel(level);
                          setDeliveryConfigured(false);
                          setDeliveryOptions([]);
                          setDeliveryOptionsResolved(false);
                          setSelectedDeliveryPlanId("");
                          setSelectedImageAssetId("");
                          setQuotes([]);
                          setQuotesResolved(false);
                          setQuotesError(null);
                          autoDeliveryAttempted.current = false;
                          setDeliveryRetry((current) => current + 1);
                        }}
                      >
                        {resolveParchinLevelLabel(level, parchinLabels)}
                      </button>
                    ))}
                </div>

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

                {!deliveryConfigured ? (
                  <section
                    className="recommendation-details delivery-config-card"
                    aria-labelledby="delivery-configuration-title"
                  >
                    <div className="result-recommendation-head">
                      <div>
                        <span>تنظیمات تحویل</span>
                        <h2 id="delivery-configuration-title">
                          موقعیت، سیستم‌عامل و روش دسترسی را تأیید کن
                        </h2>
                        <p>
                          این انتخاب پیش از قفل‌شدن قیمت با ظرفیت و قیمت واقعی
                          دوباره بررسی می‌شود.
                        </p>
                      </div>
                    </div>

                    {!deliveryOptionsResolved ? (
                      <div className="quick-plans-empty" aria-live="polite">
                        <RefreshCw className="spin" size={22} aria-hidden="true" />
                        <div>
                          <strong>در حال دریافت گزینه‌های قابل فروش…</strong>
                        </div>
                      </div>
                    ) : deliveryOptions.length === 0 ? (
                      <div className="quick-plans-empty" role="status">
                        <ShieldCheck size={22} aria-hidden="true" />
                        <div>
                          <strong>
                            {quotesError ??
                              "در حال حاضر چینش معتبر و تازه‌ای برای این نیاز وجود ندارد."}
                          </strong>
                          <button
                            className="button button-quiet"
                            type="button"
                            onClick={() => {
                              setQuotesError(null);
                              setDeliveryOptionsResolved(false);
                              autoDeliveryAttempted.current = false;
                              setDeliveryRetry((current) => current + 1);
                            }}
                          >
                            <RefreshCw size={15} aria-hidden="true" />
                            تلاش دوباره
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="delivery-config-grid">
                          <label>
                            موقعیت و منابع
                            <select
                              value={selectedDeliveryPlanId}
                              onChange={(event) => {
                                const planId = event.target.value;
                                const option = deliveryOptions.find(
                                  (item) => item.id === planId,
                                );
                                const image = option?.images[0];
                                setSelectedDeliveryPlanId(planId);
                                setSelectedImageAssetId(image?.id ?? "");
                                setAccessMethod(
                                  image?.windows
                                    ? "WINDOWS_PASSWORD"
                                    : "ONE_TIME_PASSWORD",
                                );
                              }}
                            >
                              {deliveryOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.region} — {option.vcpu} vCPU،{" "}
                                  {option.ramGb} GB RAM، {option.storageGb} GB
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            سیستم‌عامل
                            <select
                              value={selectedImageAssetId}
                              onChange={(event) => {
                                const imageId = event.target.value;
                                const image =
                                  selectedDeliveryOption?.images.find(
                                    (item) => item.id === imageId,
                                  );
                                setSelectedImageAssetId(imageId);
                                setAccessMethod(
                                  image?.windows
                                    ? "WINDOWS_PASSWORD"
                                    : "ONE_TIME_PASSWORD",
                                );
                              }}
                            >
                              {selectedDeliveryOption?.images.map((image) => (
                                <option key={image.id} value={image.id}>
                                  {image.displayName || image.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            نام سرور
                            <input
                              maxLength={64}
                              dir="ltr"
                              placeholder="abrchin-x8k2"
                              value={serverName}
                              aria-invalid={
                                serverNameTouched &&
                                !isValidCustomerServerName(serverName)
                              }
                              onChange={(event) => {
                                setServerNameTouched(true);
                                setServerName(event.target.value);
                              }}
                            />
                          </label>
                        </div>
                        {serverNameTouched &&
                        !isValidCustomerServerName(serverName) ? (
                          <small role="alert">
                            نام سرور باید ۲ تا ۶۴ کاراکتر حرف یا عدد باشد.
                          </small>
                        ) : null}

                        <div
                          className="result-direction"
                          aria-label="روش دسترسی"
                        >
                          {selectedDeliveryImage?.windows ? (
                            <button className="is-active" type="button">
                              رمز عبور ویندوز
                            </button>
                          ) : (
                            <button className="is-active" type="button">
                              رمز عبور امن
                            </button>
                          )}
                        </div>
                        <details className="ready-server-advanced">
                          <summary>تنظیمات پیشرفته</summary>
                          <p>
                            ورود با رمز عبور امن به‌صورت پیش‌فرض فعال است. انتخاب
                            کلید SSH برای خرید مستقیم فعلاً در دسترس نیست.
                          </p>
                        </details>

                        <button
                          className="button button-primary delivery-config-submit"
                          disabled={
                            savingDelivery ||
                            !selectedImageAssetId ||
                            !isValidCustomerServerName(serverName) ||
                            accessMethod === "SSH_KEY"
                          }
                          type="button"
                          onClick={() => void confirmDelivery()}
                        >
                          {savingDelivery
                            ? "در حال بررسی…"
                            : "تأیید تنظیمات و دریافت قیمت قفل‌شده"}
                          <ArrowLeft size={17} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </section>
                ) : null}

                <div className="result-live-plans">
                  <div>
                    <span>
                      {showComparisons
                        ? "مقایسهٔ اختیاری چینش‌های واقعی"
                        : "پیشنهاد اصلی واقعی ابرچین"}
                    </span>
                    <strong>
                      {showComparisons && quotes.length >= 3
                        ? "قیمت‌های فروش تأیید شده‌اند"
                        : quotesLoading
                          ? "در حال بررسی قیمت و ظرفیت واقعی"
                          : "ظرفیت‌های معتبر موجود نمایش داده شده‌اند"}
                    </strong>
                  </div>
                  {deliveryConfigured ? (
                    <div className="result-purchase-controls">
                      <label>
                        دوره شارژ
                        <select
                          value={termMonths}
                          onChange={(event) => {
                            setTermMonths(
                              Number(event.target.value) as 1 | 3 | 6 | 12,
                            );
                            setQuotesResolved(false);
                            setQuotes([]);
                          }}
                        >
                          <option value={1}>۱ ماه — بدون تخفیف دوره</option>
                          <option value={3}>۳ ماه · تا ۵٪ تخفیف</option>
                          <option value={6}>۶ ماه · تا ۱۰٪ تخفیف</option>
                          <option value={12}>۱۲ ماه · تا ۲۰٪ تخفیف</option>
                        </select>
                      </label>
                      <details className="ready-server-coupon">
                        <summary>کد تخفیف دارید؟</summary>
                        <label>
                          کد تخفیف سرور
                          <input
                            value={couponCode}
                            onChange={(event) =>
                              setCouponCode(event.target.value.toUpperCase())
                            }
                            onBlur={() => {
                              setQuotesResolved(false);
                              setQuotes([]);
                              setQuotesRetry((current) => current + 1);
                            }}
                            placeholder="مثلاً LAUNCH20"
                            maxLength={32}
                          />
                        </label>
                        <p className="ready-server-coupon-note">
                          با کد تخفیف خرید سرور، تخفیف دوره‌ای حذف و درصد کد اعمال
                          می‌شود.
                        </p>
                      </details>
                    </div>
                  ) : null}
                  {!deliveryConfigured ? (
                    <section className="quick-plans-empty" role="status">
                      <Info size={24} aria-hidden="true" />
                      <div>
                        <strong>
                          برای دیدن قیمت قفل‌شده، ابتدا تنظیمات تحویل را تأیید
                          کن.
                        </strong>
                      </div>
                    </section>
                  ) : quotesError ? (
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
                      <QuickCloudPlans
                        quotes={quotes}
                        signedIn={signedIn}
                        compact
                        parchinLabels={parchinLabels}
                      />
                      {servicePackages.length > 0 ? (
                        <section
                          className="compass-services"
                          aria-labelledby="compass-services-title"
                        >
                          <h3 id="compass-services-title">
                            خدمات همراه (جدا از خرید سرور)
                          </h3>
                          <p className="compass-services-lead">
                            این مسیر خدمت‌محور است؛ اجرا پس از بررسی تیم ابرچین
                            انجام می‌شود. سرور پیشنهادی بالا از فهرست واقعی
                            ابرچین است.
                          </p>
                          <ul className="compass-services-list">
                            {servicePackages.map((pack) => (
                              <li key={pack.code}>
                                <div className="compass-service-info">
                                  <strong>{pack.title}</strong>
                                  <p>{pack.description}</p>
                                </div>
                                <div className="compass-service-action">
                                  <span>{pack.priceTomanFa} تومان</span>
                                  <button
                                    type="button"
                                    className="button button-quiet"
                                    disabled={serviceRequesting === pack.code}
                                    onClick={() => {
                                      if (!sessionId) return;
                                      if (!signedIn) {
                                        setServiceMessage("برای ثبت درخواست خدمت وارد شو.");
                                        return;
                                      }
                                      setServiceRequesting(pack.code);
                                      setServiceMessage(null);
                                      void fetch(
                                        `/api/recommendations/sessions/${sessionId}/service-requests`,
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            packageCode: pack.code,
                                          }),
                                        },
                                      )
                                        .then(async (response) => {
                                          const data = (await response.json()) as {
                                            error?: string;
                                            alreadyRequested?: boolean;
                                          };
                                          if (!response.ok) {
                                            throw new Error(
                                              data.error ?? "ثبت درخواست ممکن نیست.",
                                            );
                                          }
                                          setServiceMessage(
                                            data.alreadyRequested
                                              ? "این درخواست قبلاً ثبت شده و در صف بررسی تیم ابرچین است."
                                              : `درخواست «${pack.title}» ثبت شد؛ تیم ابرچین بررسی می‌کند.`,
                                          );
                                        })
                                        .catch((error: unknown) => {
                                          setServiceMessage(
                                            error instanceof Error
                                              ? error.message
                                              : "ثبت درخواست ممکن نیست.",
                                          );
                                        })
                                        .finally(() => setServiceRequesting(null));
                                    }}
                                  >
                                    {serviceRequesting === pack.code
                                      ? "در حال ثبت..."
                                      : "درخواست این خدمت"}
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                          {serviceMessage ? (
                            <p className="compass-services-message" role="status">
                              {serviceMessage}
                            </p>
                          ) : null}
                        </section>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="conversation-result-actions">
                  <button className="button button-quiet" type="button" onClick={back}>
                    <ArrowRight size={17} aria-hidden="true" />
                    یک چیز رو عوض کنیم
                  </button>
                  <Link className="button button-primary" href="/cloud-servers">
                    همه سرورهای ابری
                    <ArrowLeft size={17} aria-hidden="true" />
                  </Link>
                </div>
              </motion.div>
            ) : null}
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
