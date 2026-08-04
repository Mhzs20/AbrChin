"use client";

import {
  CircleHelp,
  CreditCard,
  Home,
  LayoutGrid,
  Receipt,
  Server,
  ShoppingBag,
  User,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  MobileHeader,
  MobileNavigation,
  ProductShell,
  SidebarGroup,
  SidebarLink,
  isNavActive,
  type NavItem,
} from "@/components/product";
import { formatTomanFa } from "@/lib/money";
import type { PublicUser } from "@/lib/session";

const mainNav: NavItem[] = [
  { href: "/account", label: "نمای کلی", icon: Home, shortLabel: "خانه" },
  { href: "/cloud-servers", label: "راهکار فوری", icon: ShoppingBag, shortLabel: "راهکار فوری" },
  { href: "/account/services", label: "سرویس‌های من", icon: Server, shortLabel: "سرویس" },
  { href: "/account/orders", label: "سفارش‌های من", icon: ShoppingBag, shortLabel: "سفارش" },
  { href: "/account/wallet", label: "کیف پول", icon: Wallet, shortLabel: "کیف" },
  { href: "/account/transactions", label: "تراکنش‌ها", icon: Receipt, shortLabel: "تراکنش" },
];

const secondaryNav: NavItem[] = [
  { href: "/account/profile", label: "پروفایل", icon: User },
  { href: "/account/support", label: "راهنما و پشتیبانی", icon: CircleHelp },
];

const drawerGroups = [
  { items: mainNav },
  { title: "حساب", items: secondaryNav },
];

export function CustomerShell({
  user,
  pathname,
  walletBalanceRial,
  children,
}: {
  user: PublicUser;
  pathname: string;
  walletBalanceRial?: string;
  children: ReactNode;
}) {
  const displayName = user.displayName || "مشتری ابرچین";

  return (
    <ProductShell
      variant="account"
      sidebar={
        <>
          <Link href="/account" className="product-sidebar-brand">
            <Image src="/assets/abrchin-symbol.svg" alt="" width={32} height={28} />
            <span>پنل مشتری</span>
          </Link>
          <SidebarGroup>
            {mainNav.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
              />
            ))}
          </SidebarGroup>
          <SidebarGroup title="حساب">
            {secondaryNav.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
              />
            ))}
          </SidebarGroup>
        </>
      }
      header={
        <div className="product-header-meta">
          <div>
            <strong>{displayName}</strong>
            <div style={{ fontSize: 13, color: "var(--product-muted)" }} dir="ltr">{user.mobile}</div>
          </div>
          {walletBalanceRial != null ? (
            <div className="product-header-wallet">
              موجودی: <span className="product-tech">{formatTomanFa(BigInt(walletBalanceRial))}</span> تومان
            </div>
          ) : null}
          <Link href="/account/wallet/topup" className="product-btn product-btn--primary">
            <CreditCard size={16} aria-hidden="true" />
            شارژ کیف پول
          </Link>
        </div>
      }
      mobileHeader={
        <MobileHeader title="پنل مشتری" userName={displayName} groups={drawerGroups} pathname={pathname} />
      }
      mobileNav={<MobileNavigation items={mainNav} pathname={pathname} extraIcon={LayoutGrid} extraHref="/account/profile" extraLabel="بیشتر" />}
    >
      {children}
    </ProductShell>
  );
}
