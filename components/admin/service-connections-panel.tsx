"use client";

import { useState } from "react";

import { SectionCard, StatusBadge } from "@/components/product";

type Capability = {
  key: string;
  label: string;
  status: "VERIFIED" | "UNVERIFIED" | "UNSUPPORTED";
  note: string;
};

type Connection = {
  service: "ARVAN" | "PARSPACK" | "KAVENEGAR" | "PAYMENT_GATEWAY";
  label: string;
  configured: boolean;
  status: "HEALTHY" | "UNCONFIGURED" | "UNVERIFIED" | "ERROR";
  message: string;
  checkedAt: string | null;
  errorCode: string | null;
  capabilities: Capability[];
};

const connectionTone = (status: Connection["status"]) =>
  status === "HEALTHY" ? "success" : status === "ERROR" ? "danger" : "warning";

const capabilityTone = (status: Capability["status"]) =>
  status === "VERIFIED" ? "success" : status === "UNSUPPORTED" ? "neutral" : "warning";

export function ServiceConnectionsPanel({ initialConnections }: { initialConnections: Connection[] }) {
  const [connections, setConnections] = useState(initialConnections);
  const [checking, setChecking] = useState<Connection["service"] | null>(null);
  const [error, setError] = useState("");

  async function check(service: Connection["service"]) {
    setChecking(service);
    setError("");
    try {
      const response = await fetch("/api/admin/service-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const data = await response.json();
      if (!response.ok || !data.connection) {
        setError(typeof data.error === "string" ? data.error : "بررسی اتصال ممکن نشد.");
        return;
      }
      setConnections((current) => current.map((connection) =>
        connection.service === service ? data.connection as Connection : connection,
      ));
    } catch {
      setError("ارتباط با پنل برقرار نشد.");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error ? <p className="product-error">{error}</p> : null}
      {connections.map((connection) => (
        <SectionCard
          key={connection.service}
          title={connection.label}
          actions={
            <button
              type="button"
              className="product-btn product-btn--primary"
              disabled={checking !== null}
              onClick={() => check(connection.service)}
            >
              {checking === connection.service ? "در حال بررسی…" : "بررسی اتصال"}
            </button>
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge label={connection.message} tone={connectionTone(connection.status)} />
              <span className="product-tech">{connection.configured ? "Secret تنظیم شده" : "Secret تنظیم نشده"}</span>
              <span className="product-tech">
                آخرین بررسی: {connection.checkedAt ? new Date(connection.checkedAt).toLocaleString("fa-IR") : "—"}
              </span>
            </div>
            {connection.errorCode ? <p style={{ margin: 0, color: "var(--product-muted)" }}>کد امن خطا: {connection.errorCode}</p> : null}
            <div style={{ overflowX: "auto" }}>
              <table className="product-table">
                <thead><tr><th>Capability</th><th>وضعیت</th><th>توضیح</th></tr></thead>
                <tbody>
                  {connection.capabilities.map((capability) => (
                    <tr key={capability.key}>
                      <td>{capability.label}</td>
                      <td><StatusBadge label={capability.status} tone={capabilityTone(capability.status)} /></td>
                      <td>{capability.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
