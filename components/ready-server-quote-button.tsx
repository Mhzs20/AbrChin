"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type AccessMethod =
  | "SSH_KEY"
  | "ONE_TIME_PASSWORD"
  | "WINDOWS_PASSWORD";

type DeliveryOptions = {
  planId: string;
  region: string;
  images: Array<{
    id: string;
    label: string;
    accessMethods: AccessMethod[];
  }>;
};

const accessLabels: Record<AccessMethod, string> = {
  SSH_KEY: "کلید SSH تأییدشده",
  ONE_TIME_PASSWORD: "رمز یک‌بارمصرف لینوکس",
  WINDOWS_PASSWORD: "رمز یک‌بارمصرف ویندوز",
};

export function ReadyServerQuoteButton({
  planId,
  productPath = "cloud-servers",
  disabled = false,
  disabledReason,
  requireLogin = false,
  autoExpand = false,
}: {
  planId: string;
  productPath?: "cloud-servers" | "ready-servers";
  disabled?: boolean;
  disabledReason?: string;
  /** Customer must login (mobile OTP) before configuring the server. */
  requireLogin?: boolean;
  /** Open the delivery form on mount (used after login redirect). */
  autoExpand?: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoExpandedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<DeliveryOptions | null>(null);
  const [imageAssetId, setImageAssetId] = useState("");
  const [accessMethod, setAccessMethod] =
    useState<AccessMethod | "">("");
  const [sshKeyName, setSshKeyName] = useState("");
  const [serverName, setServerName] = useState("");
  const [termMonths, setTermMonths] = useState<1 | 3 | 6 | 12>(1);
  const [couponCode, setCouponCode] = useState("");
  const requestKeyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const termLabels: Record<1 | 3 | 6 | 12, string> = {
    1: "۱ ماه — بدون تخفیف دوره",
    3: "۳ ماه — ۵٪ تخفیف",
    6: "۶ ماه — ۱۰٪ تخفیف",
    12: "۱۲ ماه — ۲۰٪ تخفیف",
  };
  const selectedImage = useMemo(
    () => options?.images.find((image) => image.id === imageAssetId) ?? null,
    [imageAssetId, options],
  );

  function goToLogin() {
    const next = `/cloud-servers?plan=${encodeURIComponent(planId)}#plan-${planId}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }

  async function loadDeliveryOptions() {
    if (requireLogin) {
      goToLogin();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/${productPath}/quotes?planId=${encodeURIComponent(planId)}`,
      );
      const body = (await response.json()) as DeliveryOptions & {
        error?: string;
      };
      if (!response.ok || !body.images?.length) {
        throw new Error(body.error ?? "تنظیمات تحویل معتبر پیدا نشد.");
      }
      setOptions(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تنظیمات تحویل معتبر پیدا نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createQuote() {
    if (!imageAssetId || !accessMethod) {
      setError("سیستم‌عامل و روش دسترسی را انتخاب کن.");
      return;
    }
    if (!serverName.trim()) {
      setError("نام سرور را وارد کن.");
      return;
    }
    if (accessMethod === "SSH_KEY" && !sshKeyName.trim()) {
      setError("نام کلید SSH ثبت‌شده را وارد کن.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({
        planId,
        imageAssetId,
        accessMethod,
        serverName: serverName.trim(),
        termMonths,
        couponCode: couponCode.trim().toUpperCase() || null,
        sshKeyName:
          accessMethod === "SSH_KEY" ? sshKeyName.trim() : null,
      });
      if (requestKeyRef.current?.fingerprint !== fingerprint) {
        requestKeyRef.current = {
          fingerprint,
          key: crypto.randomUUID(),
        };
      }
      const idempotencyKey = requestKeyRef.current.key;
      const response = await fetch(`/api/${productPath}/quotes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          planId,
          imageAssetId,
          accessMethod,
          serverName: serverName.trim(),
          termMonths,
          couponCode: couponCode.trim() || null,
          sshKeyName: accessMethod === "SSH_KEY" ? sshKeyName.trim() : null,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        quote?: { id?: string };
      };
      if (!response.ok || !body.quote?.id) {
        throw new Error(body.error ?? "دریافت قیمت زنده ممکن نشد.");
      }
      router.push(`/${productPath}/quote/${body.quote.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "دریافت قیمت زنده ممکن نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (
      autoExpand &&
      !requireLogin &&
      !disabled &&
      !autoExpandedRef.current
    ) {
      autoExpandedRef.current = true;
      void loadDeliveryOptions();
      containerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand, disabled, requireLogin]);

  return (
    <div className="ready-server-quote-action" id={`plan-${planId}`} ref={containerRef}>
      {options ? (
        <div className="ready-server-delivery-config">
          <label>
            سیستم‌عامل
            <select
              value={imageAssetId}
              onChange={(event) => {
                setImageAssetId(event.target.value);
                setAccessMethod("");
              }}
            >
              <option value="">انتخاب کن</option>
              {options.images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.label}
                </option>
              ))}
            </select>
          </label>
          {selectedImage ? (
            <label>
              روش دسترسی امن
              <select
                value={accessMethod}
                onChange={(event) =>
                  setAccessMethod(event.target.value as AccessMethod)
                }
              >
                <option value="">انتخاب کن</option>
                {selectedImage.accessMethods.map((method) => (
                  <option key={method} value={method}>
                    {accessLabels[method]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            نام سرور
            <input
              maxLength={64}
              placeholder="مثلاً shop-main"
              value={serverName}
              onChange={(event) => setServerName(event.target.value)}
            />
          </label>
          <label>
            مدت شارژ
            <select
              value={termMonths}
              onChange={(event) =>
                setTermMonths(Number(event.target.value) as 1 | 3 | 6 | 12)
              }
            >
              {([1, 3, 6, 12] as const).map((months) => (
                <option key={months} value={months}>
                  {termLabels[months]}
                </option>
              ))}
            </select>
          </label>
          <label>
            کد تخفیف (اختیاری)
            <input
              maxLength={32}
              placeholder="مثلاً ABRCHIN20"
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value)}
            />
          </label>
          <small>
            با کد تخفیف خرید سرور، تخفیف ثابت ۵/۱۰/۲۰٪ دوره حذف و درصد کد اعمال
            می‌شود.
          </small>
          {accessMethod === "SSH_KEY" ? (
            <label>
              نام کلید SSH ثبت‌شده
              <input
                dir="ltr"
                maxLength={128}
                value={sshKeyName}
                onChange={(event) => setSshKeyName(event.target.value)}
              />
            </label>
          ) : null}
          <small>
            سیستم‌عامل و نام سرور قبل از پرداخت قفل می‌شوند و پس از ساخت همان
            مشخصات در پنل «ابرچین‌ها» دیده می‌شود.
          </small>
          <button
            className="button button-primary"
            disabled={loading || !imageAssetId || !accessMethod || !serverName.trim()}
            onClick={createQuote}
            type="button"
          >
            {loading ? (
              <>
                <LoaderCircle
                  className="ready-server-spinner"
                  size={17}
                  aria-hidden="true"
                />
                بررسی قیمت و ظرفیت
              </>
            ) : (
              <>
                تأیید تنظیمات و دریافت Quote
                <ArrowLeft size={17} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      ) : (
        <button
          className="button button-primary"
          disabled={loading || disabled}
          onClick={loadDeliveryOptions}
          type="button"
        >
          {disabled ? (
            disabledReason ?? "در انتظار بررسی دوبارهٔ ظرفیت"
          ) : loading ? (
            <>
              <LoaderCircle
                className="ready-server-spinner"
                size={17}
                aria-hidden="true"
              />
              دریافت تنظیمات معتبر
            </>
          ) : requireLogin ? (
            <>
              ورود و انتخاب همین سرور
              <ArrowLeft size={17} aria-hidden="true" />
            </>
          ) : (
            <>
              انتخاب سیستم‌عامل و تحویل
              <ArrowLeft size={17} aria-hidden="true" />
            </>
          )}
        </button>
      )}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
