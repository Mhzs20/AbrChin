"use client";

import { useRef, useState } from "react";

import { ConfirmDialog, FormField, MoneyDisplay } from "@/components/product";

export function FundingConfirmButton({
  orderId,
  requiredTomanFa,
  adminName,
}: {
  orderId: string;
  requiredTomanFa: string;
  adminName: string;
}) {
  const [open, setOpen] = useState(false);
  const [fundedAmountToman, setFundedAmountToman] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  function openDialog() {
    idempotencyKeyRef.current = crypto.randomUUID();
    setOpen(true);
  }

  async function confirm() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/infrastructure/orders/${orderId}/confirm-funding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundedAmountToman: Number(fundedAmountToman),
          receiptReference,
          note,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "تأیید ممکن نشد.");
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="product-btn product-btn--primary" onClick={openDialog}>
        شارژ پارس‌پک انجام شد
      </button>
      <ConfirmDialog
        open={open}
        title="تأیید شارژ پارس‌پک"
        confirmLabel="تأیید نهایی"
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      >
        <p>مبلغ موردنیاز: <MoneyDisplay amount={requiredTomanFa} /></p>
        <FormField id="funded-amount" label="مبلغ شارژ‌شده (تومان)">
          <input
            id="funded-amount"
            type="number"
            min={1}
            value={fundedAmountToman}
            onChange={(e) => setFundedAmountToman(e.target.value)}
            required
          />
        </FormField>
        <FormField id="receipt-ref" label="شماره رسید (اختیاری)">
          <input id="receipt-ref" value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} />
        </FormField>
        <FormField id="funding-note" label="یادداشت (اختیاری)">
          <textarea id="funding-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </FormField>
        <p>مدیر: {adminName}</p>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
