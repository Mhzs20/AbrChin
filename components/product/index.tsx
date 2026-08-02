import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  shortLabel?: string;
};

export type NavGroup = {
  title?: string;
  items: NavItem[];
};

export function isNavActive(pathname: string, href: string) {
  if (href === "/account" || href === "/admin") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProductShell({
  children,
  sidebar,
  header,
  mobileHeader,
  mobileNav,
  variant = "account",
}: {
  children: ReactNode;
  sidebar: ReactNode;
  header: ReactNode;
  mobileHeader: ReactNode;
  mobileNav: ReactNode;
  variant?: "account" | "admin";
}) {
  return (
    <div className={`product-root product-shell product-shell--${variant}`}>
      {mobileHeader}
      <aside className="product-sidebar" aria-label="منوی کناری">
        {sidebar}
      </aside>
      <header className="product-header">{header}</header>
      <main className="product-main" id="main-content">
        {children}
      </main>
      {mobileNav}
    </div>
  );
}

export function SidebarGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="product-sidebar-group">
      {title ? <div className="product-sidebar-group-title">{title}</div> : null}
      {children}
    </div>
  );
}

export function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      className={`product-sidebar-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="product-page-header">
      <div>
        {breadcrumb}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="product-page-header-actions">{actions}</div> : null}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="product-breadcrumb" aria-label="مسیر">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
          {index < items.length - 1 ? <span aria-hidden="true"> / </span> : null}
        </span>
      ))}
    </nav>
  );
}

export function SectionCard({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="product-section">
      {(title || actions) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          {title ? <h2 className="product-section-title">{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="product-stat-card">
      <div className="product-stat-card-label">{label}</div>
      <div className="product-stat-card-value">{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "var(--product-muted)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return <span className={`product-badge product-badge--${tone}`}>{label}</span>;
}

export function MoneyDisplay({ amount, suffix = "تومان" }: { amount: string; suffix?: string }) {
  return (
    <span>
      <span className="product-tech">{amount}</span> {suffix}
    </span>
  );
}

export function TechnicalValue({ children }: { children: ReactNode }) {
  return <span className="product-tech">{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="product-empty">
      <h3 style={{ margin: "0 0 8px", color: "var(--product-navy)" }}>{title}</h3>
      {description ? <p style={{ margin: "0 0 16px" }}>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <div className="product-error" role="alert">{message}</div>;
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="product-skeleton" style={{ height: 48 }} />
      ))}
    </div>
  );
}

export function FormField({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="product-form-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <span style={{ fontSize: 12, color: "var(--product-muted)" }}>{hint}</span> : null}
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  emptyMessage = "موردی یافت نشد.",
}: {
  columns: Array<{ key: string; header: string }>;
  rows: Array<{ id: string; cells: Record<string, ReactNode> }>;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }
  return (
    <div className="product-table-wrap">
      <table className="product-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{row.cells[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResponsiveRowList({
  rows,
}: {
  rows: Array<{ id: string; title: ReactNode; fields: Array<{ label: string; value: ReactNode }>; actions?: ReactNode }>;
}) {
  return (
    <div className="product-row-list">
      {rows.map((row) => (
        <article key={row.id} className="product-row-card">
          <div style={{ fontWeight: 700, marginBottom: 12 }}>{row.title}</div>
          <dl>
            {row.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          {row.actions ? <div style={{ marginTop: 12 }}>{row.actions}</div> : null}
        </article>
      ))}
    </div>
  );
}

export function Timeline({ items }: { items: Array<{ id: string; title: string; description?: string; done?: boolean }> }) {
  return (
    <div className="product-timeline">
      {items.map((item) => (
        <div
          key={item.id}
          className={`product-timeline-item${item.done ? " done" : " pending"}`}
        >
          <span className="product-timeline-dot" aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            {item.description ? <div style={{ fontSize: 13, color: "var(--product-muted)" }}>{item.description}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="product-filter-bar">{children}</div>;
}

export function SearchField({
  id,
  value,
  onChange,
  placeholder = "جست‌وجو...",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      style={{ minWidth: 200, flex: 1 }}
    />
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="product-pagination">
      <button
        type="button"
        className="product-btn product-btn--quiet"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        قبلی
      </button>
      <span>صفحه {page} از {totalPages}</span>
      <button
        type="button"
        className="product-btn product-btn--quiet"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        بعدی
      </button>
    </div>
  );
}

export { CustomerShell } from "@/components/product/customer-shell";
export { AdminShell } from "@/components/product/admin-shell";
export { ConfirmDialog } from "@/components/product/confirm-dialog";
export { DetailDrawer } from "@/components/product/detail-drawer";
export { MobileHeader } from "@/components/product/mobile-header";
export { MobileNavigation } from "@/components/product/mobile-navigation";
export { ToastProvider, useToast } from "@/components/product/toast";
