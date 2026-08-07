"use client";

import { useEffect, useState } from "react";

function formatLockedUntilFa(expiresAt: string) {
  const date = new Date(expiresAt);
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function remainingLabel(expiresAt: string, now: number) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now) / 1000),
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return {
    expired: remainingSeconds === 0,
    lockedUntil: formatLockedUntilFa(expiresAt),
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
        : `قیمت تا ${remaining.lockedUntil} برای شما قفل شده است (${remaining.label})`}
    </span>
  );
}
