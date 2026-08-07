import Link from "next/link";

const legalLinks = [
  { href: "/terms", label: "شرایط استفاده" },
  { href: "/privacy", label: "حریم خصوصی" },
  { href: "/refund-policy", label: "بازپرداخت" },
  { href: "/service-policy", label: "سیاست خدمات" },
  { href: "/support", label: "پشتیبانی" },
] as const;

export function LegalPageNav({ current }: { current?: string }) {
  return (
    <nav className="legal-page-nav" aria-label="صفحات حقوقی">
      {legalLinks.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={current === item.href ? "page" : undefined}
          className={current === item.href ? "is-current" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
