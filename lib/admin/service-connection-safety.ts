export type SafeConnectionFailure = {
  code: "auth" | "timeout" | "contract_mismatch" | "unavailable";
  message: string;
};

export function toSafeConnectionFailure(error: unknown): SafeConnectionFailure {
  const value = error instanceof Error ? error.message.toLowerCase() : "";
  if (value.includes("abort") || value.includes("timeout")) {
    return { code: "timeout", message: "زمان پاسخ سرویس تمام شد." };
  }
  if (
    value.includes("401") ||
    value.includes("403") ||
    value.includes("unauthor") ||
    value.includes("forbidden") ||
    value.includes("auth")
  ) {
    return { code: "auth", message: "اعتبار دسترسی سرویس پذیرفته نشد." };
  }
  if (
    value.includes("contract") ||
    value.includes("invalid_response") ||
    value.includes("invalid_json") ||
    value.includes("version")
  ) {
    return { code: "contract_mismatch", message: "پاسخ سرویس با قرارداد مورد انتظار سازگار نیست." };
  }
  return { code: "unavailable", message: "اتصال سرویس در حال حاضر در دسترس نیست." };
}

export function isSafePaymentCallbackBaseUrl(value: string, isProduction: boolean) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (isProduction) return url.protocol === "https:";
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
