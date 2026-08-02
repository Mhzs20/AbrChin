"use client";

import {
  Bell,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Server,
  Settings,
  Shield,
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
import type { PublicUser } from "@/lib/session";

const mainNav: NavItem[] = [
  { href: "/admin", label: "مرکز عملیات", icon: LayoutDashboard, shortLabel: "عملیات" },
  { href: "/admin/connections", label: "اتصال سرویس‌ها", icon: Building2, shortLabel: "اتصال" },
  { href: "/admin/infrastructure/providers#catalog", label: "کاتالوگ Providerها", icon: Server, shortLabel: "کاتالوگ" },
  { href: "/admin/infrastructure/plans", label: "SKUهای ابرچین", icon: Server, shortLabel: "SKU" },
  { href: "/admin/infrastructure/orders", label: "سفارش‌ها و تحویل", icon: FileText, shortLabel: "سفارش" },
  { href: "/admin/transactions", label: "پرداخت‌ها و مشتریان", icon: CreditCard, shortLabel: "پرداخت" },
  { href: "/admin/settings", label: "تنظیمات پیشرفته", icon: Settings, shortLabel: "تنظیمات" },
];

const drawerGroups = [
  { title: "عملیات فروش", items: mainNav },
  {
    title: "ابزارهای پیشرفته",
    items: [
      { href: "/admin/instances", label: "سرورها", icon: Server },
      { href: "/admin/users", label: "کاربران", icon: FileText },
      { href: "/admin/wallets", label: "کیف پول‌ها", icon: CreditCard },
      { href: "/admin/payment-gateways", label: "درگاه‌های پرداخت", icon: CreditCard },
      { href: "/admin/audit", label: "گزارش عملیات", icon: FileText },
    ],
  },
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
          <SidebarGroup>
            {mainNav.map((item) => (
              <SidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isNavActive(pathname, item.href)} />
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
              <div style={{ fontSize: 13, color: "var(--product-muted)" }} dir="ltr">{user.mobile}</div>
            </div>
          </div>
          <Link href="/admin/notifications" className="product-btn product-btn--quiet">
            <Bell size={16} aria-hidden="true" />
            اعلان‌ها
            {unreadNotifications > 0 ? ` (${unreadNotifications.toLocaleString("fa-IR")})` : ""}
          </Link>
        </div>
      }
      mobileHeader={
        <MobileHeader title="پنل مدیریت" userName={user.displayName || "مدیر"} groups={drawerGroups} pathname={pathname} />
      }
      mobileNav={<MobileNavigation items={mainNav} pathname={pathname} extraIcon={Settings} extraHref="/admin/settings" extraLabel="بیشتر" />}
    >
      {children}
    </ProductShell>
  );
}
