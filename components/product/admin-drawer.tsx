"use client";

import Link from "next/link";

import { SidebarGroup, SidebarLink, isNavActive } from "@/components/product";
import {
  Bell,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Server,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

const groups = [
  {
    title: "اصلی",
    items: [
      { href: "/admin", label: "داشبورد", icon: LayoutDashboard },
      { href: "/admin/infrastructure/orders", label: "سفارش‌های تأمین", icon: Building2 },
      { href: "/admin/instances", label: "سرورها", icon: Server },
      { href: "/admin/users", label: "کاربران", icon: Users },
      { href: "/admin/notifications", label: "اعلان‌ها", icon: Bell },
    ],
  },
  {
    title: "زیرساخت",
    items: [
      { href: "/admin/infrastructure/plans", label: "پلن‌ها", icon: Server },
      { href: "/admin/infrastructure/providers", label: "تأمین‌کننده‌ها", icon: Building2 },
    ],
  },
  {
    title: "مالی",
    items: [
      { href: "/admin/wallets", label: "کیف پول‌ها", icon: Wallet },
      { href: "/admin/transactions", label: "تراکنش‌ها", icon: CreditCard },
      { href: "/admin/payment-gateways", label: "درگاه‌ها", icon: CreditCard },
      { href: "/admin/wallet-topup-settings", label: "تنظیمات شارژ", icon: Settings },
    ],
  },
  {
    title: "سیستم",
    items: [
      { href: "/admin/audit", label: "گزارش عملیات", icon: FileText },
      { href: "/admin/settings", label: "تنظیمات", icon: Settings },
    ],
  },
];

export function AdminDrawer({ pathname }: { pathname: string }) {
  return (
    <div className="product-drawer" style={{ display: "none" }} aria-hidden="true">
      {groups.map((group) => (
        <SidebarGroup key={group.title} title={group.title}>
          {group.items.map((item) => (
            <SidebarLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isNavActive(pathname, item.href)} />
          ))}
        </SidebarGroup>
      ))}
      <Link href="/account" className="product-sidebar-link" style={{ marginTop: 16 }}>
        بازگشت به پنل کاربری
      </Link>
    </div>
  );
}
