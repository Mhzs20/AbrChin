"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { isNavActive, type NavItem } from "@/components/product";

export function MobileNavigation({
  items,
  pathname,
  extraHref,
  extraLabel,
  extraIcon: ExtraIcon,
}: {
  items: NavItem[];
  pathname: string;
  extraHref?: string;
  extraLabel?: string;
  extraIcon?: LucideIcon;
}) {
  const visible = items.slice(0, 4);
  return (
    <nav className="product-mobile-nav" aria-label="ناوبری پایین">
      {visible.map((item) => {
        const Icon = item.icon;
        const active = isNavActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.shortLabel || item.label}</span>
          </Link>
        );
      })}
      {extraHref && ExtraIcon ? (
        <Link href={extraHref} className={isNavActive(pathname, extraHref) ? "active" : ""}>
          <ExtraIcon size={18} aria-hidden="true" />
          <span>{extraLabel}</span>
        </Link>
      ) : null}
    </nav>
  );
}
