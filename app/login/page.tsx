import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "ورود | ابرچین",
  description: "ورود به حساب ابرچین با شماره موبایل و کد یکبارمصرف.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <section className="auth-page page-view" aria-label="ورود">
      <LoginForm />
    </section>
  );
}
