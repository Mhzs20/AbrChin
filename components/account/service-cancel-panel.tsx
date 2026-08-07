"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/product/confirm-dialog";
import { formatTomanFa } from "@/lib/money";

type Preview = {
  originalPaidRial: string;
  consumedRial: string;
  nonRefundableRial: string;
  refundableRial: string;
  walletBalanceRial: string;
  walletBalanceAfterRefundRial: string;
  originalPaidTomanFa: string;
  consumedTomanFa: string;
  nonRefundableTomanFa: string;
  refundableTomanFa: string;
  walletBalanceTomanFa: string;
  walletBalanceAfterRefundTomanFa: string;
  serviceStartedAt: string;
  termMonths: number;
};

type SuccessState = {
  amountRial: string;
  ledgerEntryId: string | null;
  createdAt: string;
};

export function ServiceCancelPanel({
  instanceId,
  serverName,
}: {
  instanceId: string;
  serverName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/account/instances/${instanceId}/cancel`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        error?: string;
        preview?: Preview;
        lifecycle?: string;
      };
      if (!response.ok || !body.preview) {
        throw new Error(body.error ?? "محاسبه بازگشت اعتبار ممکن نیست.");
      }
      setPreview(body.preview);
      setLifecycle(body.lifecycle ?? null);
      setConfirmOpen(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "محاسبه بازگشت اعتبار ممکن نیست.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmCancel() {
    if (!preview) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      keyRef.current ??= crypto.randomUUID();
      const response = await fetch(
        `/api/account/instances/${instanceId}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": keyRef.current,
          },
          body: JSON.stringify({}),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        lifecycle?: string;
        refund?: {
          amountRial: string;
          ledgerEntryId: string | null;
          createdAt: string;
        } | null;
        preview?: Preview;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "ثبت لغو سرویس ممکن نیست.");
      }
      setLifecycle(body.lifecycle ?? null);
      setConfirmOpen(false);
      if (body.lifecycle === "REFUND_CREDITED" && body.refund) {
        setSuccess({
          amountRial: body.refund.amountRial,
          ledgerEntryId: body.refund.ledgerEntryId,
          createdAt: body.refund.createdAt,
        });
        setMessage("سرویس لغو شد");
      } else {
        setMessage(body.message ?? "درخواست لغو ثبت شد.");
        if (body.preview) setPreview(body.preview);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ثبت لغو سرویس ممکن نیست.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="service-cancel-panel service-cancel-panel--done">
        <h3>سرویس لغو شد</h3>
        <p>
          {formatTomanFa(BigInt(success.amountRial))} تومان به کیف پول شما
          برگشت.
        </p>
        <ul>
          <li>
            تاریخ:{" "}
            <strong>
              {new Date(success.createdAt).toLocaleString("fa-IR")}
            </strong>
          </li>
          {success.ledgerEntryId ? (
            <li>
              مرجع تراکنش:{" "}
              <strong dir="ltr">{success.ledgerEntryId}</strong>
            </li>
          ) : null}
        </ul>
        <Link className="product-btn product-btn--primary" href="/account/transactions">
          مشاهده تراکنش کیف پول
        </Link>
      </div>
    );
  }

  return (
    <div className="service-cancel-panel">
      <h3>لغو سرویس</h3>
      <p>
        لغو «{serverName}» اعتبار استفاده‌نشده را به کیف پول ابرچین برمی‌گرداند؛
        بازگشت بانکی خودکار انجام نمی‌شود.
      </p>
      <button
        type="button"
        className="product-btn product-btn--quiet"
        style={{ minHeight: 44 }}
        disabled={loading}
        onClick={() => void loadPreview()}
      >
        {loading ? "در حال محاسبه…" : "لغو سرویس"}
      </button>
      {lifecycle === "CANCEL_REQUESTED" || lifecycle === "TERMINATING" ? (
        <p className="product-success" role="status">
          درخواست لغو ثبت شده و منتظر خاتمه قطعی سرور است.
        </p>
      ) : null}
      {lifecycle === "TERMINATION_FAILED" ? (
        <p className="product-error" role="alert">
          خاتمه خودکار Provider ناموفق بود؛ ابرچین باید خاتمه را تکمیل کند. تا
          آن زمان مبلغی به کیف پول برنمی‌گردد.
        </p>
      ) : null}
      {message ? <p className="product-success">{message}</p> : null}
      {error ? <p className="product-error">{error}</p> : null}

      <ConfirmDialog
        open={confirmOpen && preview != null}
        title="تأیید لغو سرویس"
        loading={loading}
        confirmLabel={
          preview
            ? `لغو سرویس و بازگشت ${preview.refundableTomanFa} تومان به کیف پول`
            : "تأیید"
        }
        cancelLabel="انصراف"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmCancel()}
      >
        {preview ? (
          <div className="service-cancel-preview">
            <p>پیش‌نمایش بازگشت اعتبار بر اساس مصرف مستقیم دوره پیش‌پرداخت:</p>
            <div className="service-cancel-row">
              <span>اعتبار خرید</span>
              <strong>{preview.originalPaidTomanFa} تومان</strong>
            </div>
            <div className="service-cancel-row">
              <span>شروع سرویس</span>
              <strong>
                {new Date(preview.serviceStartedAt).toLocaleString("fa-IR")}
              </strong>
            </div>
            <div className="service-cancel-row">
              <span>مصرف‌شده</span>
              <strong>{preview.consumedTomanFa} تومان</strong>
            </div>
            {BigInt(preview.nonRefundableRial) > 0n ? (
              <div className="service-cancel-row">
                <span>غیرقابل بازگشت</span>
                <strong>{preview.nonRefundableTomanFa} تومان</strong>
              </div>
            ) : null}
            <div className="service-cancel-row service-cancel-row--total">
              <span>مبلغ قابل بازگشت</span>
              <strong>{preview.refundableTomanFa} تومان</strong>
            </div>
            <div className="service-cancel-row">
              <span>موجودی کیف پول پس از بازگشت</span>
              <strong>{preview.walletBalanceAfterRefundTomanFa} تومان</strong>
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
