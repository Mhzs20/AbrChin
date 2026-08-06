"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export type ParchinDetailsContent = {
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  includedServices?: string[];
  excludedServices?: string[];
  monthlyPriceRial?: string | null;
  supportWindow?: string | null;
  firstResponseTarget?: string | null;
};

function formatIncludedPrice(monthlyPriceRial?: string | null) {
  if (monthlyPriceRial == null) return "شامل قیمت";
  try {
    const rial = BigInt(monthlyPriceRial);
    if (rial <= 0n) return "شامل قیمت";
    return `${(rial / 10n).toLocaleString("fa-IR")} تومان در ماه`;
  } catch {
    return "شامل قیمت";
  }
}

export function ParchinDetailsDialog({
  open,
  onClose,
  content,
}: {
  open: boolean;
  onClose: () => void;
  content: ParchinDetailsContent | null;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !content) return null;

  return (
    <div
      className="parchin-dialog-root"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="parchin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="parchin-dialog-header">
          <div>
            <h2 id={titleId}>{content.title}</h2>
            {content.subtitle ? <p>{content.subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="button button-quiet"
            aria-label="بستن جزئیات پرچین"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {content.summary ? (
          <p className="parchin-dialog-summary">{content.summary}</p>
        ) : null}

        <p className="parchin-dialog-price">
          هزینه ماهانه: {formatIncludedPrice(content.monthlyPriceRial)}
        </p>

        {content.includedServices && content.includedServices.length > 0 ? (
          <section aria-label="خدمات شامل">
            <h3>شامل می‌شود</h3>
            <ul>
              {content.includedServices.map((item) => (
                <li key={`in-${item}`}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {content.excludedServices && content.excludedServices.length > 0 ? (
          <section aria-label="خدمات خارج از قرارداد">
            <h3>شامل نمی‌شود</h3>
            <ul>
              {content.excludedServices.map((item) => (
                <li key={`ex-${item}`}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {(content.supportWindow || content.firstResponseTarget) && (
          <footer className="parchin-dialog-support">
            {content.supportWindow ? (
              <p>پنجره پشتیبانی: {content.supportWindow}</p>
            ) : null}
            {content.firstResponseTarget ? (
              <p>هدف پاسخ اولیه: {content.firstResponseTarget}</p>
            ) : null}
          </footer>
        )}
      </div>
    </div>
  );
}
