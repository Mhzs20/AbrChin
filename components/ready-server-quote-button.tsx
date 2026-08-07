"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  generateCustomerServerName,
  isValidCustomerServerName,
} from "@/lib/infrastructure/image-identity";
import { formatStorefrontToman } from "@/lib/storefront/presentation";

type AccessMethod =
  | "SSH_KEY"
  | "ONE_TIME_PASSWORD"
  | "WINDOWS_PASSWORD";

type DeliveryImage = {
  id: string;
  label: string;
  displayName?: string;
  distribution?: string;
  version?: string | null;
  architecture?: string | null;
  windows?: boolean;
  accessMethods: AccessMethod[];
  defaultAccessMethod?: AccessMethod;
  sshSelectable?: boolean;
};

type DeliveryOptions = {
  planId: string;
  region: string;
  defaultServerName?: string;
  sshSelfServeAvailable?: boolean;
  images: DeliveryImage[];
};

export type ReadyServerOrderSummary = {
  title: string;
  locationLabel: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  transferTb?: string | null;
  diskTypeLabel?: string | null;
  ipv4Available?: boolean | null;
  ipv6Available?: boolean | null;
  operatingSystemLabels?: string[];
  parchinTitle: string;
  parchinSummary?: string | null;
  parchinIncludedServices?: string[];
  parchinExcludedServices?: string[];
  salePriceRial: string;
  renewalPriceRial: string;
  instantDelivery?: boolean;
};

function imageDisplayName(image: DeliveryImage) {
  return image.displayName || image.label;
}

function defaultAccessForImage(image: DeliveryImage | null): AccessMethod | "" {
  if (!image) return "";
  if (image.defaultAccessMethod) return image.defaultAccessMethod;
  if (image.windows || image.accessMethods.includes("WINDOWS_PASSWORD")) {
    return "WINDOWS_PASSWORD";
  }
  if (image.accessMethods.includes("ONE_TIME_PASSWORD")) {
    return "ONE_TIME_PASSWORD";
  }
  return image.accessMethods[0] ?? "";
}

export function ReadyServerQuoteButton({
  planId,
  productPath = "cloud-servers",
  disabled = false,
  disabledReason,
  requireLogin = false,
  autoExpand = false,
  orderSummary,
}: {
  planId: string;
  productPath?: "cloud-servers" | "ready-servers";
  disabled?: boolean;
  disabledReason?: string;
  /** Customer must login (mobile OTP) before configuring the server. */
  requireLogin?: boolean;
  /** Open the delivery form on mount (used after login redirect). */
  autoExpand?: boolean;
  orderSummary?: ReadyServerOrderSummary;
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
  const [serverName, setServerName] = useState("");
  const [serverNameTouched, setServerNameTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [termMonths, setTermMonths] = useState<1 | 3 | 6 | 12>(1);
  const [couponCode, setCouponCode] = useState("");
  const requestKeyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const termLabels: Record<1 | 3 | 6 | 12, string> = {
    1: "۱ ماه — بدون تخفیف دوره",
    3: "۳ ماه — تا ۵٪ تخفیف",
    6: "۶ ماه — تا ۱۰٪ تخفیف",
    12: "۱۲ ماه — تا ۲۰٪ تخفیف",
  };
  const selectedImage = useMemo(
    () => options?.images.find((image) => image.id === imageAssetId) ?? null,
    [imageAssetId, options],
  );
  const serverNameValid = isValidCustomerServerName(serverName);
  const accessLabel =
    accessMethod === "WINDOWS_PASSWORD"
      ? "رمز عبور ویندوز"
      : "رمز عبور امن";

  function applyImageSelection(imageId: string, images: DeliveryImage[]) {
    const image = images.find((item) => item.id === imageId) ?? null;
    setImageAssetId(imageId);
    setAccessMethod(defaultAccessForImage(image));
    setShowAdvanced(false);
  }

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
      const firstImage = body.images[0]!;
      applyImageSelection(firstImage.id, body.images);
      setServerName(body.defaultServerName || generateCustomerServerName());
      setServerNameTouched(false);
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
      setError("سیستم‌عامل را انتخاب کن.");
      return;
    }
    if (!serverNameValid) {
      setError("نام سرور معتبر نیست.");
      return;
    }
    if (accessMethod === "SSH_KEY") {
      setError("انتخاب کلید SSH فعلاً برای خرید مستقیم در دسترس نیست.");
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
          sshKeyName: null,
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
          {orderSummary ? (
            <div className="ready-server-order-summary" aria-label="خلاصه سفارش">
              <strong>{orderSummary.title}</strong>
              <ul>
                <li>
                  پردازنده:{" "}
                  <span dir="ltr">{orderSummary.vcpu ?? "—"} vCPU</span>
                </li>
                <li>
                  حافظه: <span dir="ltr">{orderSummary.ramGb ?? "—"} GB</span>
                </li>
                <li>
                  دیسک:{" "}
                  <span dir="ltr">{orderSummary.storageGb ?? "—"} GB</span>
                </li>
                <li>موقعیت: {orderSummary.locationLabel}</li>
                {orderSummary.operatingSystemLabels &&
                orderSummary.operatingSystemLabels.length > 0 ? (
                  <li>
                    سیستم‌عامل‌های قابل نصب:{" "}
                    {orderSummary.operatingSystemLabels.join("، ")}
                  </li>
                ) : null}
                {orderSummary.transferTb ? (
                  <li>
                    ترافیک: <span dir="ltr">{orderSummary.transferTb}</span>
                  </li>
                ) : null}
                {orderSummary.diskTypeLabel ? (
                  <li>نوع دیسک: {orderSummary.diskTypeLabel}</li>
                ) : null}
                {orderSummary.ipv4Available != null ? (
                  <li>
                    IPv4: {orderSummary.ipv4Available ? "دارد" : "ندارد"}
                  </li>
                ) : null}
                {orderSummary.ipv6Available != null ? (
                  <li>
                    IPv6: {orderSummary.ipv6Available ? "دارد" : "ندارد"}
                  </li>
                ) : null}
                <li>پرچین: {orderSummary.parchinTitle}</li>
                {orderSummary.parchinSummary ? (
                  <li>{orderSummary.parchinSummary}</li>
                ) : null}
                {orderSummary.instantDelivery !== false ? (
                  <li>تحویل فوری پس از تأیید ظرفیت</li>
                ) : null}
                <li>
                  قیمت پایه یک‌ماهه:{" "}
                  {formatStorefrontToman(orderSummary.salePriceRial)} تومان
                </li>
                <li>
                  مبلغ تمدید ماهانه:{" "}
                  {formatStorefrontToman(orderSummary.renewalPriceRial)} تومان
                </li>
              </ul>
              {orderSummary.parchinIncludedServices &&
              orderSummary.parchinIncludedServices.length > 0 ? (
                <details>
                  <summary>خدمات پرچین</summary>
                  <ul>
                    {orderSummary.parchinIncludedServices.map((item) => (
                      <li key={`inc-${item}`}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {orderSummary.parchinExcludedServices &&
              orderSummary.parchinExcludedServices.length > 0 ? (
                <details>
                  <summary>خارج از پرچین</summary>
                  <ul>
                    {orderSummary.parchinExcludedServices.map((item) => (
                      <li key={`exc-${item}`}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          <label>
            سیستم‌عامل
            <select
              value={imageAssetId}
              onChange={(event) =>
                applyImageSelection(event.target.value, options.images)
              }
            >
              {options.images.map((image) => (
                <option key={image.id} value={image.id}>
                  {imageDisplayName(image)}
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
              aria-invalid={serverNameTouched && !serverNameValid}
              onChange={(event) => {
                setServerNameTouched(true);
                setServerName(event.target.value);
              }}
            />
          </label>
          {serverNameTouched && !serverNameValid ? (
            <small role="alert">
              نام سرور باید ۲ تا ۶۴ کاراکتر حرف یا عدد باشد.
            </small>
          ) : null}

          <div className="ready-server-access-summary" aria-live="polite">
            <span>دسترسی</span>
            <strong>{accessLabel}</strong>
          </div>

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
          <details className="ready-server-coupon">
            <summary>کد تخفیف دارید؟</summary>
            <label>
              کد تخفیف
              <input
                maxLength={32}
                placeholder="مثلاً ABRCHIN20"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value)}
              />
            </label>
            <small>
              با کد تخفیف خرید سرور، تخفیف دوره‌ای حذف و درصد کد اعمال می‌شود.
              نتیجه روی پیش‌فاکتور قفل‌شده دیده می‌شود.
            </small>
          </details>

          <details
            className="ready-server-advanced"
            open={showAdvanced}
            onToggle={(event) =>
              setShowAdvanced((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>تنظیمات پیشرفته</summary>
            <p>
              ورود با رمز عبور امن به‌صورت پیش‌فرض فعال است. انتخاب کلید SSH برای
              خرید مستقیم فعلاً در دسترس نیست.
            </p>
          </details>

          <small>
            سیستم‌عامل و نام سرور قبل از پرداخت قفل می‌شوند و پس از ساخت همان
            مشخصات در پنل «ابرچین‌ها» دیده می‌شود.
          </small>
          <button
            className="button button-primary"
            disabled={
              loading ||
              !imageAssetId ||
              !accessMethod ||
              !serverNameValid ||
              accessMethod === "SSH_KEY"
            }
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
                در حال ثبت سفارش
              </>
            ) : (
              <>
                ثبت سفارش
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
              در حال آماده‌سازی
            </>
          ) : (
            <>
              ثبت سفارش
              <ArrowLeft size={17} aria-hidden="true" />
            </>
          )}
        </button>
      )}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
