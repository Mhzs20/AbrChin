import type { Metadata } from "next";
import Link from "next/link";

import { AiConnectionForm } from "@/components/account/ai-connection-form";
import {
  EmptyState,
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { getCustomerAiSurface } from "@/lib/messagego/customer/surface";

export const metadata: Metadata = {
  title: "هوش مصنوعی | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function reservationTone(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "SETTLED" || status === "RECONCILED") return "success";
  if (status === "RESERVED") return "info";
  if (status === "UNCERTAIN") return "warning";
  if (status === "RELEASED") return "neutral";
  return "neutral";
}

export default async function AccountAiPage() {
  const user = await requireCustomerPage();
  const surface = await getCustomerAiSurface(user.id);

  return (
    <>
      <PageHeader
        title="هوش مصنوعی و صورتحساب"
        description="ابرچین مرجع کیف پول و نتیجه مالی است. اجرای مدل با MessageGo است و ابرچین پروکسی استنتاج نیست."
        actions={
          <Link href="/account/wallet" className="product-btn product-btn--quiet">
            کیف پول
          </Link>
        }
      />

      <div className="product-stat-grid">
        <StatCard
          label="موجودی قابل استفاده"
          value={<MoneyDisplay amount={surface.wallet.available_balance_toman_fa} />}
        />
        <StatCard
          label="رزرو هوش مصنوعی"
          value={<MoneyDisplay amount={surface.wallet.reserved_ai_toman_fa} />}
        />
        <StatCard
          label="کنترل‌پلن MessageGo"
          value={surface.control_plane.available ? "در دسترس" : "در دسترس نیست"}
        />
      </div>

      {surface.control_plane.fail_closed ? (
        <SectionCard title="وضعیت اجرا">
          <p>
            اتصال MessageGo تنظیم نشده است. ابرچین درخواست استنتاج را اجرا نمی‌کند و تحویل کلید
            ارائه‌دهنده تا زمان در دسترس بودن کنترل‌پلن بسته می‌ماند.
          </p>
        </SectionCard>
      ) : (
        <SectionCard title="مرز اختیار">
          <p>
            حساب و کیف پول در ابرچین است. اجرا، کاتالوگ مدل و Secret ارائه‌دهنده در MessageGo
            می‌ماند.
          </p>
        </SectionCard>
      )}

      <SectionCard title="رزرو و تسویه">
        {surface.reservations.length === 0 ? (
          <EmptyState
            title="رزرو هوش مصنوعی ثبت نشده"
            description="وقتی MessageGo رزرو مالی بخواهد، نتیجه در کیف پول ابرچین دیده می‌شود."
          />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {surface.reservations.map((row) => (
              <li key={row.authority_reservation_id}>
                <StatusBadge label={row.status_label} tone={reservationTone(row.status)} />
                <div>
                  رزرو <MoneyDisplay amount={row.hold_amount_toman_fa} />
                  {" · مانده "}
                  <MoneyDisplay amount={row.remaining_hold_toman_fa} />
                  {" · تسویه "}
                  <MoneyDisplay amount={row.settled_amount_toman_fa} />
                </div>
                <div className="product-tech">
                  محصول {row.product_id} / فضای کاری {row.workspace_id}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AiConnectionForm
        failClosed={surface.control_plane.fail_closed}
        connections={surface.connections}
      />
    </>
  );
}
