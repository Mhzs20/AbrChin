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
  Users,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  AdminDrawer,
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
  { href: "/admin", label: "داشبورد", icon: LayoutDashboard, shortLabel: "داشبورد" },
  { href: "/admin/infrastructure/orders", label: "سفارش‌های تأمین", icon: Building2, shortLabel: "تأمین" },
  { href: "/admin/instances", label: "سرورها", icon: Server, shortLabel: "سرور" },
  { href: "/admin/users", label: "کاربران", icon: Users, shortLabel: "کاربر" },
  { href: "/admin/notifications", label: "اعلان‌ها", icon: Bell, shortLabel: "اعلان" },
];

const infraNav: NavItem[] = [
  { href: "/admin/infrastructure/plans", label: "پلن‌های زیرساخت", icon: Server },
  { href: "/admin/infrastructure/providers", label: "تأمین‌کننده‌ها", icon: Building2 },
];

const financeNav: NavItem[] = [
  { href: "/admin/wallets", label: "کیف پول‌ها", icon: Wallet },
  { href: "/admin/transactions", label: "تراکنش‌ها", icon: CreditCard },
  { href: "/admin/payment-gateways", label: "درگاه‌های پرداخت", icon: CreditCard },
  { href: "/admin/wallet-topup-settings", label: "تنظیمات شارژ", icon: Settings },
];

const systemNav: NavItem[] = [
  { href: "/admin/audit", label: "گزارش عملیات", icon: FileText },
  { href: "/admin/settings", label: "تنظیمات", icon: Settings },
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
          <SidebarGroup title="زیرساخت">
            {infraNav.map((item) => (
              <SidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isNavActive(pathname, item.href)} />
            ))}
          </SidebarGroup>
          <SidebarGroup title="مالی">
            {financeNav.map((item) => (
              <SidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isNavActive(pathname, item.href)} />
            ))}
          </SidebarGroup>
          <SidebarGroup title="سیستم">
            {systemNav.map((item) => (
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
      mobileHeader={<MobileHeader title="پنل مدیریت" userName={user.displayName || "مدیر"} drawerTarget="admin" />}
      mobileNav={<MobileNavigation items={mainNav} pathname={pathname} extraIcon={Settings} extraHref="/admin/settings" extraLabel="بیشتر" />}
    >
      <AdminDrawer pathname={pathname} />
      {children}
    </ProductShell>
  );
}
