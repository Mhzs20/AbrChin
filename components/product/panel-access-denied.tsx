import { ShieldX } from "lucide-react";
import Link from "next/link";

import { SwitchAccountButton } from "@/components/auth/switch-account-button";

export function AdminAccessDenied() {
  return (
    <main className="panel-access-denied" id="main-content">
      <section className="panel-access-denied-card" role="alert" aria-labelledby="admin-access-denied-title">
        <ShieldX size={40} aria-hidden="true" />
        <div>
          <p className="panel-access-denied-kicker">محدوده مدیریت ابرچین</p>
          <h1 id="admin-access-denied-title">دسترسی به پنل مدیریت مجاز نیست</h1>
          <p>
            این حساب نقش مشتری دارد. برای مدیریت ابرچین باید با یکی از حساب‌های مدیر وارد شوید.
          </p>
        </div>
        <div className="panel-access-denied-actions">
          <Link href="/account" className="product-btn product-btn--primary">
            بازگشت به پنل مشتری
          </Link>
          <SwitchAccountButton />
        </div>
      </section>
    </main>
  );
}
