"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
};

type DeliveryOptions = {
  planId: string;
  region: string;
  defaultServerName?: string;
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
  return image.accessMethods.find((method) => method !== "SSH_KEY") ?? "";
}

export function ReadyServerQuoteButton({
  planId,
  productPath = "cloud-servers",
  disabled = false,
  disabledReason,
  requireLogin = false,
  standalone = false,
  orderSummary,
}: {
  planId: string;
  productPath?: "cloud-servers" | "ready-servers";
  disabled?: boolean;
  disabledReason?: string;
  requireLogin?: boolean;
  /** Full configurator is rendered only on the dedicated account page. */
  standalone?: boolean;
  orderSummary?: ReadyServerOrderSummary;
}) {
  const router = useRouter();
  const loadedRef = useRef(false);
  const requestKeyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<DeliveryOptions | null>(null);
  const [imageAssetId, setImageAssetId] = useState("");
  const [accessMethod, setAccessMethod] = useState<AccessMethod | "">("");
  const [serverName, setServerName] = useState("");
  const [serverNameTouched, setServerNameTouched] = useState(false);
  const [termMonths, setTermMonths] = useState<1 | 3 | 6 | 12>(1);
  const [couponCode, setCouponCode] = useState("");
  const termLabels: Record<1 | 3 | 6 | 12, string> = {
    1: "۱ ماه — بدون تخفیف دوره",
    3: "۳ ماه — ۵٪ تخفیف",
    6: "۶ ماه — ۱۰٪ تخفیف",
    12: "۱۲ ماه — ۲۰٪ تخفیف",
  };
  const serverNameValid = isValidCustomerServerName(serverName);

  function configurationPath() {
    const query = new URLSearchParams({ product: productPath });
    return `/account/order/configure/${encodeURIComponent(planId)}?${query.toString()}`;
  }

  function beginOrder() {
    const next = configurationPath();
    if (requireLogin) {
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    router.push(next);
  }

  function applyImageSelection(imageId: string, images: DeliveryImage[]) {
    const image = images.find((item) => item.id === imageId) ?? null;
    setImageAssetId(imageId);
    setAccessMethod(defaultAccessForImage(image));
  }

  async function loadDeliveryOptions() {
    if (!standalone || disabled || loadedRef.current) return;
    loadedRef.current = true;
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
        throw new Error(
          body.error ?? "برای این سرور سیستم‌عامل قابل انتخاب پیدا نشد.",
        );
      }
      setOptions(body);
      const firstImage = body.images[0]!;
      applyImageSelection(firstImage.id, body.images);
      setServerName(body.defaultServerName || generateCustomerServerName());
      setServerNameTouched(false);
    } catch (caught) {
      loadedRef.current = false;
      setError(
        caught instanceof Error
          ? caught.message
          : "آماده‌سازی سفارش ممکن نشد.",
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
      const response = await fetch(`/api/${productPath}/quotes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKeyRef.current.key,
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
        throw new Error(body.error ?? "ساخت پیش‌فاکتور ممکن نشد.");
      }
      router.push(`/${productPath}/quote/${body.quote.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ساخت پیش‌فاکتور ممکن نشد.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDeliveryOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, planId, productPath]);

  if (!standalone) {
    return (
      <div className="ready-server-quote-action" id={`plan-${planId}`}>
        <button
          className="button button-primary"
          disabled={disabled}
          onClick={beginOrder}
          type="button"
        >
          {disabled ? (
            disabledReason ?? "این پلن فعلاً قابل خرید نیست"
          ) : (
            <>
              انتخاب و خرید
              <ArrowLeft size={17} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="server-order-configurator">
      <aside className="server-order-overview" aria-label="اطلاعات سرور انتخابی">
        {orderSummary ? (
          <>
            <div>
              <span className="server-order-kicker">سرور انتخابی</span>
              <h2>{orderSummary.title}</h2>
              <p>{orderSummary.locationLabel}</p>
            </div>
            <dl className="server-order-specs">
              <div>
                <dt>پردازنده</dt>
                <dd dir="ltr">{orderSummary.vcpu ?? "—"} vCPU</dd>
              </div>
              <div>
                <dt>حافظه</dt>
                <dd dir="ltr">{orderSummary.ramGb ?? "—"} GB</dd>
              </div>
              <div>
                <dt>فضای دیسک</dt>
                <dd dir="ltr">{orderSummary.storageGb ?? "—"} GB</dd>
              </div>
            </dl>
            <div className="server-order-parchin">
              <span>سطح خدمات</span>
              <strong>{orderSummary.parchinTitle}</strong>
              {orderSummary.parchinSummary ? (
                <p>{orderSummary.parchinSummary}</p>
              ) : null}
            </div>
            <div className="server-order-base-price">
              <span>قیمت یک‌ماهه</span>
              <strong>
                {formatStorefrontToman(orderSummary.salePriceRial)} تومان
              </strong>
              <small>مبلغ نهایی پس از انتخاب مدت و کد تخفیف محاسبه می‌شود.</small>
            </div>
          </>
        ) : (
          <p>اطلاعات سرور در حال آماده‌سازی است.</p>
        )}
      </aside>

      <section className="server-order-fields" aria-labelledby="server-order-fields-title">
        <div>
          <span className="server-order-kicker">تکمیل سفارش</span>
          <h2 id="server-order-fields-title">مشخصات سرورت را انتخاب کن</h2>
          <p>این چهار مورد قبل از پرداخت روی پیش‌فاکتور قفل می‌شوند.</p>
        </div>

        {loading && !options ? (
          <div className="server-order-loading" aria-live="polite">
            <LoaderCircle
              className="ready-server-spinner"
              size={20}
              aria-hidden="true"
            />
            در حال آماده‌سازی سیستم‌عامل‌ها
          </div>
        ) : null}

        {options ? (
          <div className="server-order-form">
            <label>
              <span>سیستم‌عامل و نسخه</span>
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
              <span>نام سرور</span>
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
              {serverNameTouched && !serverNameValid ? (
                <small role="alert">
                  نام سرور باید ۲ تا ۶۴ کاراکتر و فقط شامل حرف، عدد یا خط تیره باشد.
                </small>
              ) : null}
            </label>

            <label>
              <span>مدت خرید</span>
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
              <span>کد تخفیف <small>(اختیاری)</small></span>
              <input
                maxLength={32}
                dir="ltr"
                placeholder="ABRCHIN20"
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value)}
              />
            </label>

            <button
              className="product-btn product-btn--primary server-order-submit"
              disabled={
                loading || !imageAssetId || !accessMethod || !serverNameValid
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
                  در حال ساخت پیش‌فاکتور
                </>
              ) : (
                <>
                  بررسی مبلغ و ادامه خرید
                  <ArrowLeft size={17} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="server-order-error" role="alert">
            <p>{error}</p>
            <button
              className="product-btn product-btn--quiet"
              onClick={() => void loadDeliveryOptions()}
              type="button"
            >
              تلاش دوباره
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
