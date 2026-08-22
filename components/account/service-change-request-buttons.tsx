"use client";

import Link from "next/link";
import { specGbFa, specVcpuFa } from "@/lib/labels/customer";

export function ServiceChangeRequestButtons({
  instanceId,
  orderId,
  serverName,
  currentResources,
}: {
  instanceId: string;
  orderId?: string;
  serverName: string;
  currentResources?: {
    vcpu?: number | null;
    ramGb?: number | null;
    diskGb?: number | null;
  } | null;
}) {
  const resourcesLabel =
    currentResources &&
    (currentResources.vcpu || currentResources.ramGb || currentResources.diskGb)
      ? [
          currentResources.vcpu != null ? specVcpuFa(currentResources.vcpu) : null,
          currentResources.ramGb != null
            ? `${specGbFa(currentResources.ramGb)} رم`
            : null,
          currentResources.diskGb != null
            ? `${specGbFa(currentResources.diskGb)} دیسک`
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;

  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link
          className="product-btn product-btn--quiet"
          style={{ minHeight: 44 }}
          href={`/account/services/${instanceId}/upgrade`}
          aria-label={`ارتقای سرور ${serverName}`}
          title={resourcesLabel ?? undefined}
        >
          ارتقای سرور
        </Link>
        {orderId ? (
          <Link
            className="product-btn product-btn--quiet"
            style={{ minHeight: 44 }}
            href={`/account/orders/${orderId}#cancel-service`}
          >
            لغو سرویس
          </Link>
        ) : null}
      </span>
    </span>
  );
}
