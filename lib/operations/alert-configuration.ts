import { getEnv } from "@/lib/env";

export type OperationalAlertConfigurationStatus =
  | "READY"
  | "CONFIG_REQUIRED"
  | "DISABLED";

export function getOperationalAlertConfigurationStatus(): {
  status: OperationalAlertConfigurationStatus;
  safeCode: string | null;
} {
  const env = getEnv();
  if (env.smsProvider !== "kavenegar") {
    return { status: "DISABLED", safeCode: null };
  }
  if (
    !env.kavenegarApiKey.trim() ||
    !env.kavenegarAlertTemplate.trim() ||
    env.adminMobiles.length === 0
  ) {
    return {
      status: "CONFIG_REQUIRED",
      safeCode: "kavenegar_alert_config_required",
    };
  }
  return { status: "READY", safeCode: null };
}
