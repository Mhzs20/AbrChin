import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { safeCustomerReturnPath } from "@/lib/customer/navigation";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "ورود | ابرچین",
  description: "ورود به حساب ابرچین با شماره موبایل و کد یکبارمصرف.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [user, { next }] = await Promise.all([getCurrentUser(), searchParams]);
  if (user) {
    if (user.role === "ADMIN") redirect("/admin");
    redirect(safeCustomerReturnPath(next) ?? "/account");
  }

  return (
    <section className="auth-page page-view" aria-label="ورود">
      <LoginForm />
    </section>
  );
}
