"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, SectionCard } from "@/components/product";
import { useToast } from "@/components/product/toast";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_KIND_LABELS,
} from "@/lib/labels/customer";

const CATEGORIES = Object.keys(SUPPORT_CATEGORY_LABELS);
const KINDS = ["GENERAL", "ROUTINE", "P1_INCIDENT"] as const;

export function SupportRequestCreateForm({
  instances,
  initialInstanceId = "",
  initialOrderId = "",
  initialCategory,
  initialKind,
  initialSubject = "",
  initialDescription = "",
}: {
  instances: Array<{
    id: string;
    name: string;
    ipv4: string | null;
    parchinLevel: string | null;
    parchinTitle: string | null;
    routineRemaining: number | null;
  }>;
  initialInstanceId?: string;
  initialOrderId?: string;
  initialCategory?: string;
  initialKind?: string;
  initialSubject?: string;
  initialDescription?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [category, setCategory] = useState(
    initialCategory && CATEGORIES.includes(initialCategory)
      ? initialCategory
      : CATEGORIES[0] ?? "OTHER",
  );
  const [kind, setKind] = useState<(typeof KINDS)[number]>(
    initialKind && KINDS.includes(initialKind as (typeof KINDS)[number])
      ? (initialKind as (typeof KINDS)[number])
      : "GENERAL",
  );
  const [subject, setSubject] = useState(initialSubject);
  const [description, setDescription] = useState(initialDescription);
  const [cloudInstanceId, setCloudInstanceId] = useState(initialInstanceId);
  const [serviceOrderId] = useState(initialOrderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedInstance = instances.find(
    (item) => item.id === cloudInstanceId,
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/support-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          kind,
          subject,
          description,
          cloudInstanceId: cloudInstanceId || null,
          serviceOrderId: serviceOrderId || null,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        request?: { id: string };
      };
      if (!response.ok || !data.request) {
        throw new Error(data.error || "ثبت درخواست ممکن نشد.");
      }
      showToast("درخواست پشتیبانی ثبت شد.");
      router.push(`/account/support/requests/${data.request.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "ثبت درخواست ممکن نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="ثبت درخواست">
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        <FormField id="support-category" label="دسته‌بندی">
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            {CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {SUPPORT_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="support-kind"
          label="نوع درخواست"
          hint={
            selectedInstance?.routineRemaining != null
              ? `سهمیه روتین باقی‌مانده: ${selectedInstance.routineRemaining.toLocaleString("fa-IR")}`
              : "برای درخواست روتین یا P1 ابتدا سرویس فعال را انتخاب کن."
          }
        >
          <select
            id="support-kind"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as (typeof KINDS)[number])
            }
          >
            {KINDS.map((value) => (
              <option
                key={value}
                value={value}
                disabled={
                  value === "ROUTINE"
                    ? !selectedInstance ||
                      (selectedInstance.routineRemaining ?? 0) <= 0
                    : value === "P1_INCIDENT"
                      ? selectedInstance?.parchinLevel !== "PARCHIN_STABLE"
                      : false
                }
              >
                {SUPPORT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="support-subject" label="موضوع">
          <input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={160}
            required
            placeholder="مثلاً دسترسی SSH پس از تحویل"
          />
        </FormField>
        <FormField id="support-description" label="توضیحات" hint="حداقل ۱۰ کاراکتر">
          <textarea
            id="support-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            maxLength={4000}
            required
          />
        </FormField>
        <FormField
          id="support-instance"
          label="سرویس مرتبط (اختیاری)"
          hint="اگر سرویس را انتخاب کنی، اولویت بر اساس پرچین همان سرویس تنظیم می‌شود."
        >
          <select
            id="support-instance"
            value={cloudInstanceId}
            onChange={(event) => {
              const nextId = event.target.value;
              const next = instances.find((item) => item.id === nextId);
              setCloudInstanceId(nextId);
              if (
                (kind === "ROUTINE" && (next?.routineRemaining ?? 0) <= 0) ||
                (kind === "P1_INCIDENT" &&
                  next?.parchinLevel !== "PARCHIN_STABLE")
              ) {
                setKind("GENERAL");
              }
            }}
          >
            <option value="">بدون اتصال به سرویس</option>
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.ipv4 ? ` · ${item.ipv4}` : ""}
                {item.parchinTitle ? ` · ${item.parchinTitle}` : ""}
              </option>
            ))}
          </select>
        </FormField>
        {error ? (
          <p role="alert" style={{ margin: 0, color: "crimson", fontSize: 13 }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="product-btn product-btn--primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          {busy ? "در حال ثبت..." : "ثبت درخواست"}
        </button>
      </form>
    </SectionCard>
  );
}
