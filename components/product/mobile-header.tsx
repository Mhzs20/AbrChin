"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

export function MobileHeader({
  title,
  userName,
  drawerTarget,
}: {
  title: string;
  userName: string;
  drawerTarget: "account" | "admin";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="product-mobile-header">
        <button
          type="button"
          className="product-btn product-btn--quiet"
          aria-label="باز کردن منو"
          aria-expanded={open}
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
          <nav className="product-drawer" aria-label="منوی موبایل" data-drawer={drawerTarget}>
            <button type="button" className="product-btn product-btn--quiet" onClick={() => setOpen(false)} style={{ marginBottom: 16 }}>
              بستن
            </button>
            <div id={`${drawerTarget}-drawer-links`} />
          </nav>
        </>
      ) : null}
    </>
  );
}
