"use client";

import {
  Bell,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Percent,
  Server,
  Settings,
  Shield,
  Users,
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
  type NavGroup,
  type NavItem,
} from "@/components/product";
import type { PublicUser } from "@/lib/session";

/** Bottom bar + primary Launch path (first 4 used on mobile). */
const primaryNav: NavItem[] = [
  { href: "/admin", label: "مرکز عملیات", icon: LayoutDashboard, shortLabel: "عملیات" },
  {
    href: "/admin/infrastructure/orders",
    label: "سفارش‌ها و تحویل",
    icon: FileText,
    shortLabel: "سفارش",
  },
  {
    href: "/admin/infrastructure/plans",
    label: "SKUهای قابل‌فروش",
    icon: Server,
    shortLabel: "SKU",
  },
  {
    href: "/admin/infrastructure/providers",
    label: "آروان و پارس‌پک",
    icon: Building2,
    shortLabel: "منابع",
  },
];

const saleNav: NavItem[] = [
  { href: "/admin/connections", label: "اتصال سرویس‌ها", icon: Building2 },
  {
    href: "/admin/infrastructure/storefront",
    label: "چینش فروشگاهی",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/infrastructure/providers#pricing",
    label: "قیمت، پرچین، کد تخفیف",
    icon: Percent,
  },
];

const moneyNav: NavItem[] = [
  { href: "/admin/transactions", label: "تراکنش‌ها", icon: CreditCard },
  { href: "/admin/wallets", label: "کیف پول‌ها", icon: Wallet },
  { href: "/admin/wallet-topup-settings", label: "مبالغ شارژ Wallet", icon: Wallet },
  { href: "/admin/payment-gateways", label: "درگاه‌های پرداخت", icon: CreditCard },
  { href: "/admin/payment-recovery", label: "بازیابی پرداخت", icon: CreditCard },
];

const advancedNav: NavItem[] = [
  { href: "/admin/instances", label: "سرورهای تحویل‌شده", icon: Server },
  { href: "/admin/users", label: "کاربران", icon: Users },
  { href: "/admin/notifications", label: "اعلان‌ها", icon: Bell },
  { href: "/admin/audit", label: "گزارش عملیات", icon: FileText },
  { href: "/admin/settings", label: "وضعیت پیکربندی", icon: Settings },
];

const drawerGroups: NavGroup[] = [
  { title: "مسیر فروش", items: primaryNav },
  { title: "فروش و منابع", items: saleNav },
  { title: "مالی", items: moneyNav },
  { title: "پیشرفته", items: advancedNav },
];

export function AdminShell({
  user,
  pathname,
  unreadNotifications = 0,
  children,
}: {
  user: PublicUser;
  pathname: string;
  unreadNotifications?: number;
  children: ReactNode;
}) {
  return (
    <ProductShell
      variant="admin"
      sidebar={
        <>
          <Link href="/admin" className="product-sidebar-brand">
            <Image src="/assets/abrchin-symbol.svg" alt="" width={32} height={28} />
            <span>پنل مدیریت</span>
          </Link>

          <SidebarGroup title="مسیر فروش">
            {primaryNav.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup title="فروش و منابع">
            {saleNav.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup title="مالی">
            {moneyNav.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup title="پیشرفته">
            {advancedNav.map((item) => (
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={18} aria-hidden="true" />
            <div>
              <strong>{user.displayName || "مدیر"}</strong>
              <div style={{ fontSize: 13, color: "var(--product-muted)" }} dir="ltr">
                {user.mobile}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/admin/infrastructure/orders"
              className="product-btn product-btn--primary"
            >
              سفارش‌ها
            </Link>
            <Link href="/admin/notifications" className="product-btn product-btn--quiet">
              <Bell size={16} aria-hidden="true" />
              اعلان‌ها
              {unreadNotifications > 0
                ? ` (${unreadNotifications.toLocaleString("fa-IR")})`
                : ""}
            </Link>
          </div>
        </div>
      }
      mobileHeader={
        <MobileHeader
          title="پنل مدیریت"
          userName={user.displayName || "مدیر"}
          groups={drawerGroups}
          pathname={pathname}
        />
      }
      mobileNav={
        <MobileNavigation
          items={primaryNav}
          pathname={pathname}
          extraIcon={Settings}
          extraHref="/admin/settings"
          extraLabel="بیشتر"
        />
      }
    >
      {children}
    </ProductShell>
  );
}
