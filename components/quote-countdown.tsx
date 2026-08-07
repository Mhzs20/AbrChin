"use client";

import { useEffect, useState } from "react";

function remainingLabel(expiresAt: string, now: number) {
  const remainingSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return {
    expired: remainingSeconds === 0,
    label: `${minutes.toLocaleString("fa-IR")}:${seconds.toLocaleString("fa-IR", {
      minimumIntegerDigits: 2,
    })}`,
  };
}

export function QuoteCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = remainingLabel(expiresAt, now);
  return (
    <span aria-live="polite">
      {remaining.expired
        ? "اعتبار قیمت قفل‌شده تمام شد؛ قیمت را تازه کن."
        : `اعتبار قیمت قفل‌شده: ${remaining.label}`}
    </span>
  );
}
