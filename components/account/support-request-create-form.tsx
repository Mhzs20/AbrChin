"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, SectionCard } from "@/components/product";
import { useToast } from "@/components/product/toast";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/labels/customer";

const CATEGORIES = Object.keys(SUPPORT_CATEGORY_LABELS);

export function SupportRequestCreateForm({
  instances,
}: {
  instances: Array<{ id: string; name: string; ipv4: string | null }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [category, setCategory] = useState(CATEGORIES[0] ?? "OTHER");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [cloudInstanceId, setCloudInstanceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
          subject,
          description,
          cloudInstanceId: cloudInstanceId || null,
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
            onChange={(e) => setCloudInstanceId(e.target.value)}
          >
            <option value="">بدون اتصال به سرویس</option>
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.ipv4 ? ` · ${item.ipv4}` : ""}
              </option>
            ))}
          </select>
        </FormField>
        {error ? (
          <p style={{ margin: 0, color: "crimson", fontSize: 13 }}>{error}</p>
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
