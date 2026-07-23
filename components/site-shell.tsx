"use client";

import {
  CircleHelp,
  Cloud,
  Compass,
  HeartHandshake,
  Home,
  Layers3,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};

const navigation: NavigationItem[] = [
  { href: "/", label: "خانه", shortLabel: "خانه", icon: Home },
  { href: "/compass", label: "قطب‌نما", shortLabel: "قطب‌نما", icon: Compass },
  { href: "/solutions", label: "راهکارها", shortLabel: "راهکارها", icon: Layers3 },
  { href: "/support", label: "سطح همراهی", shortLabel: "همراهی", icon: HeartHandshake },
  { href: "/about", label: "درباره ابرچین", shortLabel: "درباره", icon: Cloud },
  { href: "/help", label: "راهنما و ارتباط", shortLabel: "راهنما", icon: CircleHelp },
];

const mobileNavigation = navigation.filter((item) => item.href !== "/about");

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname.startsWith(href);
}

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-canvas">
      <a className="skip-link" href="#main-content">
        رفتن به محتوای اصلی
      </a>

      <div className="ambient ambient-blue" aria-hidden="true" />
      <div className="ambient ambient-coral" aria-hidden="true" />

      <section className="site-shell" aria-label="وب‌سایت ابرچین">
        <header className="topbar">
          <Link className="brand-link" href="/" aria-label="ابرچین، صفحه خانه">
            <Image
              src="/assets/abrchin-logo.svg"
              alt="ابرچین"
              className="brand-logo"
              width={176}
              height={62}
              priority
            />
          </Link>

          <div className="topbar-actions">
            <span className="availability">
              <span className="live-dot" aria-hidden="true" />
              برای شروع کنارتیم
            </span>
            <Link className="button button-primary button-compact" href="/compass">
              <Sparkles size={17} aria-hidden="true" />
              پیشنهاد من
            </Link>
          </div>
        </header>

        <aside className="side-rail">
          <Link className="rail-mark" href="/" aria-label="خانه ابرچین">
            <Image src="/assets/abrchin-symbol.svg" alt="" width={45} height={38} />
          </Link>

          <nav className="rail-navigation" aria-label="منوی اصلی">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  className={`rail-link${active ? " active" : ""}`}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                >
                  <Icon size={20} strokeWidth={active ? 2.35 : 1.85} aria-hidden="true" />
                  <span>{item.shortLabel}</span>
                </Link>
              );
            })}
          </nav>

          <a
            className="rail-enamad"
            referrerPolicy="origin"
            target="_blank"
            href="https://trustseal.enamad.ir/?id=7019774&Code=dtWarV79z2vgp5pSlQKKMjz8QPhgWitc"
            aria-label="مشاهده اعتبار اینماد ابرچین"
          >
            <img
              referrerPolicy="origin"
              src="https://trustseal.enamad.ir/logo.aspx?id=7019774&Code=dtWarV79z2vgp5pSlQKKMjz8QPhgWitc"
              alt=""
              code="dtWarV79z2vgp5pSlQKKMjz8QPhgWitc"
              style={{ cursor: "pointer" }}
            />
          </a>
          <span className="rail-copyright">© ۱۴۰۵</span>
        </aside>

        <main className="page-stage" id="main-content">
          <div className="page-transition" key={pathname}>
            {children}
          </div>
        </main>

        <nav className="mobile-navigation" aria-label="منوی موبایل">
          {mobileNavigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                className={active ? "active" : ""}
                href={item.href}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
                <span>{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      </section>
    </div>
  );
}
