"use client";

import { useEffect, type ReactNode } from "react";

export function DetailDrawer({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="product-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="product-drawer"
        style={{ background: "var(--product-surface)", color: "var(--product-ink)" }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" className="product-btn product-btn--quiet" onClick={onClose} aria-label="بستن">
            بستن
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
