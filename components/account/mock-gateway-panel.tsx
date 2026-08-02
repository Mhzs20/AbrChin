"use client";

import { useSearchParams } from "next/navigation";

export function MockGatewayPanel() {
  const params = useSearchParams();
  const authority = params.get("authority") || "";
  const callback = params.get("callback") || "";

  function go(status: string) {
    if (!callback) return;
    const url = new URL(callback);
    url.searchParams.set("Authority", authority);
    url.searchParams.set("Status", status);
    window.location.href = url.toString();
  }

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>درگاه آزمایشی ابرچین</h1>
        <p>این صفحه فقط برای Development است و پرداخت واقعی انجام نمی‌دهد.</p>
      </div>
      <div className="account-actions">
        <button className="button button-primary" type="button" onClick={() => go("OK")}>پرداخت موفق</button>
        <button className="button button-quiet" type="button" onClick={() => go("NOK")}>پرداخت ناموفق</button>
        <button className="button button-quiet" type="button" onClick={() => go("CANCEL")}>انصراف</button>
      </div>
    </div>
  );
}
