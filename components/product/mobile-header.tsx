"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SidebarGroup, SidebarLink, isNavActive, type NavGroup } from "@/components/product";

export function MobileHeader({
  title,
  userName,
  groups,
  pathname,
}: {
  title: string;
  userName: string;
  groups: NavGroup[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const firstLink = drawerRef.current?.querySelector("a");
    firstLink?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closeDrawer = () => setOpen(false);

  return (
    <>
      <header className="product-mobile-header">
        <button
          type="button"
          className="product-btn product-btn--quiet"
          aria-label="باز کردن منو"
          aria-expanded={open}
          aria-controls="product-mobile-drawer"
          onClick={() => setOpen(true)}
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <div>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--product-muted)" }}>{userName}</div>
        </div>
      </header>
      {open ? (
        <>
          <div className="product-drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav
            ref={drawerRef}
            id="product-mobile-drawer"
            className="product-drawer"
            aria-label="منوی موبایل"
          >
            <button
              type="button"
              className="product-btn product-btn--quiet"
              onClick={() => setOpen(false)}
              style={{ marginBottom: 16 }}
            >
              بستن
            </button>
            {groups.map((group) => (
              <SidebarGroup key={group.title ?? "main"} title={group.title}>
                {group.items.map((item) => (
                  <SidebarLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isNavActive(pathname, item.href)}
                    onNavigate={closeDrawer}
                  />
                ))}
              </SidebarGroup>
            ))}
            <Link href="/" className="product-sidebar-link" style={{ marginTop: 16 }} onClick={closeDrawer}>
              بازگشت به سایت
            </Link>
          </nav>
        </>
      ) : null}
    </>
  );
}
