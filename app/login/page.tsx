import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "ورود | ابرچین",
  description: "ورود به حساب ابرچین با شماره موبایل و کد یکبارمصرف.",
  robots: { index: false, follow: false },
};

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/account";
  }
  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <section className="auth-page page-view" aria-label="ورود">
      <LoginForm nextPath={safeNextPath(params.next)} />
    </section>
  );
}
