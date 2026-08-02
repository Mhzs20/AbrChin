"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RecoveryCaseView = {
  id: string;
  attemptId: string;
  topUpId: string;
  customer: string;
  gateway: string;
  gatewayReference: string | null;
  attemptStatus: string;
  topUpStatus: string;
  reasonCode: string;
  safeMessage: string;
  expectedAmountRial: string;
  observedAmountRial: string | null;
  expectedCurrency: string;
  observedCurrency: string | null;
  nextAttemptAt: string | null;
  ledger: {
    id: string;
    status: string;
    amountRial: string;
  } | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    gateway: string;
    gatewayReference: string | null;
    createdAt: string;
  }>;
  refunds: Array<{
    id: string;
    status: string;
    amountRial: string;
    requestedAt: string;
  }>;
};

type RecoveryAction =
  | "reverify"
  | "reconcile_credit"
  | "mark_failed"
  | "controlled_refund";

const ACTION_LABEL: Record<RecoveryAction, string> = {
  reverify: "Reverify Gateway",
  reconcile_credit: "Reconcile Wallet Credit",
  mark_failed: "Mark Definitively Failed",
  controlled_refund: "Controlled Refund",
};

function formatRial(value: string | null) {
  if (value == null) return "—";
  return `${BigInt(value).toLocaleString("fa-IR")} ریال`;
}

export function PaymentRecoveryPanel({
  initialCases,
}: {
  initialCases: RecoveryCaseView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function runAction(item: RecoveryCaseView, action: RecoveryAction) {
    if (busy) return;
    const reason = window.prompt(
      `دلیل اجرای «${ACTION_LABEL[action]}» را وارد کنید:`,
    )?.trim();
    if (!reason) return;
    if (
      (action === "mark_failed" || action === "controlled_refund") &&
      !window.confirm(
        action === "mark_failed"
          ? "این پرداخت به‌صورت قطعی ناموفق علامت‌گذاری شود؟"
          : "موجودی شارژ برای بازپرداخت کنترل‌شده رزرو و کسر شود؟ هیچ Refund بانکی خودکار اجرا نمی‌شود.",
      )
    ) {
      return;
    }

    const operationKey = `${action}:${item.attemptId}`;
    setBusy(operationKey);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/payments/recovery/${item.attemptId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `admin-payment-${action}-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            action,
            reason,
            topUpId: item.topUpId,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "عملیات انجام نشد.");
        return;
      }
      setMessage("عملیات با Audit و Idempotency ثبت شد.");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  if (initialCases.length === 0) {
    return (
      <div className="account-card">
        <p className="account-empty">صف بازیابی پرداخت خالی است.</p>
      </div>
    );
  }

  return (
    <div className="account-stack">
      {error ? <p className="auth-error">{error}</p> : null}
      {message ? <p className="auth-success">{message}</p> : null}
      {initialCases.map((item) => (
        <article className="account-card" key={item.id}>
          <div className="account-card-head">
            <h2>{item.customer}</h2>
            <p>
              {item.gateway} · Attempt {item.attemptStatus} · Top-up{" "}
              {item.topUpStatus}
            </p>
          </div>
          <dl className="gateway-admin-meta">
            <div>
              <dt>Gateway Reference</dt>
              <dd dir="ltr">{item.gatewayReference || "—"}</dd>
            </div>
            <div>
              <dt>مبلغ مورد انتظار</dt>
              <dd>{formatRial(item.expectedAmountRial)}</dd>
            </div>
            <div>
              <dt>مبلغ مشاهده‌شده</dt>
              <dd>{formatRial(item.observedAmountRial)}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd dir="ltr">
                {item.expectedCurrency} / {item.observedCurrency || "—"}
              </dd>
            </div>
            <div>
              <dt>دلیل Review</dt>
              <dd dir="ltr">{item.reasonCode}</dd>
            </div>
            <div>
              <dt>Ledger نتیجه</dt>
              <dd>
                {item.ledger
                  ? `${item.ledger.status} · ${formatRial(item.ledger.amountRial)}`
                  : "ثبت نشده"}
              </dd>
            </div>
          </dl>
          <p>{item.safeMessage}</p>

          <details>
            <summary>Attempt History ({item.attempts.length})</summary>
            <ul>
              {item.attempts.map((attempt) => (
                <li key={attempt.id}>
                  #{attempt.attemptNumber} · {attempt.gateway} · {attempt.status} ·{" "}
                  <span dir="ltr">{attempt.gatewayReference || "—"}</span>
                </li>
              ))}
            </ul>
          </details>

          <div className="account-actions">
            {(
              [
                "reverify",
                "reconcile_credit",
                "mark_failed",
                "controlled_refund",
              ] as RecoveryAction[]
            ).map((action) => {
              const operationKey = `${action}:${item.attemptId}`;
              return (
                <button
                  className={
                    action === "mark_failed" || action === "controlled_refund"
                      ? "button button-danger"
                      : "button button-quiet"
                  }
                  disabled={Boolean(busy)}
                  key={action}
                  onClick={() => void runAction(item, action)}
                  type="button"
                >
                  {busy === operationKey ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : null}
                  {ACTION_LABEL[action]}
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
