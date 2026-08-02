import { Suspense } from "react";

import { MockGatewayPanel } from "@/components/account/mock-gateway-panel";
import { requireCustomerPage } from "@/lib/auth/guards";

export default async function MockGatewayPage() {
  await requireCustomerPage();

  return (
    <section className="auth-page page-view">
      <Suspense fallback={<p className="account-empty">در حال بارگذاری درگاه آزمایشی...</p>}>
        <MockGatewayPanel />
      </Suspense>
    </section>
  );
}
