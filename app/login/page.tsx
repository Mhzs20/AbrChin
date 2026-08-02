import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "ورود | ابرچین",
  description: "ورود به حساب ابرچین با شماره موبایل و کد یکبارمصرف.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/account");

  return (
    <section className="auth-page page-view" aria-label="ورود">
      <LoginForm />
    </section>
  );
}
