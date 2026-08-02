import {
  InfrastructureProvider,
  PaymentGatewayProvider,
  ServiceConnectionCheckStatus,
  ServiceConnectionName,
  type ServiceConnectionCheck,
} from "@prisma/client";

import { isSafePaymentCallbackBaseUrl, toSafeConnectionFailure } from "@/lib/admin/service-connection-safety";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { createCloudProviderAdapter, isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { ensureGatewayConfigsSeeded } from "@/lib/payments/gateway-config";
import { createProviderFor, hasServerCredentials } from "@/lib/payments/provider-factory";

type CapabilityStatus = "VERIFIED" | "UNVERIFIED" | "UNSUPPORTED";

type Capability = {
  key: string;
  label: string;
  status: CapabilityStatus;
  note: string;
};

export type ServiceConnectionView = {
  service: ServiceConnectionName;
  label: string;
  configured: boolean;
  status: ServiceConnectionCheckStatus;
  message: string;
  checkedAt: string | null;
  errorCode: string | null;
  capabilities: Capability[];
};

const serviceLabels: Record<ServiceConnectionName, string> = {
  ARVAN: "آروان‌کلاد",
  PARSPACK: "پارس‌پک",
  KAVENEGAR: "کاوه‌نگار (OTP)",
  PAYMENT_GATEWAY: "درگاه پرداخت پیش‌فرض",
};

function providerCapabilities(provider: InfrastructureProvider): Capability[] {
  const env = getEnv();
  const priceVerified =
    provider === InfrastructureProvider.ARVAN ||
    (env.parspackPriceCurrency === "IRR" &&
      ["RIAL", "TOMAN"].includes(env.parspackPriceAmountUnit));
  return [
    { key: "catalog", label: "Catalog", status: "VERIFIED", note: "خواندنی و دارای قرارداد Adapter" },
    {
      key: "price",
      label: "Price",
      status: priceVerified ? "VERIFIED" : "UNVERIFIED",
      note: priceVerified ? "قرارداد مبلغ معتبر است" : "قرارداد واحد مبلغ تأیید نشده است",
    },
    { key: "balance", label: "Balance", status: "UNVERIFIED", note: "API رسمی قابل اتکا تأیید نشده است؛ بررسی دستی لازم است" },
    {
      key: "provision",
      label: "Provision",
      status: "VERIFIED",
      note: "Adapter قراردادی وجود دارد؛ Mutation Gate جداگانه و پیش‌فرض بسته است",
    },
  ];
}

function kavenegarCapabilities(configured: boolean): Capability[] {
  return [{
    key: "otp",
    label: "OTP delivery",
    status: "UNVERIFIED",
    note: configured
      ? "پیکربندی اعتبارسنجی شد؛ Probe بدون ارسال OTP رسمی وجود ندارد"
      : "کلید، قالب یا SMS_PROVIDER تنظیم نشده است",
  }];
}

function paymentCapabilities(configured: boolean): Capability[] {
  return [
    {
      key: "configuration",
      label: "Gateway configuration",
      status: configured ? "VERIFIED" : "UNVERIFIED",
      note: configured
        ? "پیکربندی سرور و Callback معتبر است"
        : "درگاه پیش‌فرض یا تنظیمات سرور معتبر نیست",
    },
    {
      key: "non_financial_probe",
      label: "Non-financial probe",
      status: "UNSUPPORTED",
      note: "برای درگاه پیش‌فرض Probe رسمی بدون عملیات مالی تعریف نشده است",
    },
  ];
}

async function paymentConfiguration() {
  const env = getEnv();
  const gateway = await prisma.paymentGatewayConfig.findFirst({
    where: { enabled: true, isDefault: true },
    orderBy: { priority: "asc" },
  });
  const callbackValid = isSafePaymentCallbackBaseUrl(
    env.paymentCallbackBaseUrl,
    env.isProduction,
  );
  const configured = Boolean(
    gateway &&
      gateway.provider !== PaymentGatewayProvider.MOCK &&
      hasServerCredentials(gateway.provider) &&
      callbackValid,
  );
  return { gateway, configured, callbackValid };
}

async function derivedConnection(service: ServiceConnectionName) {
  const env = getEnv();
  if (service === ServiceConnectionName.ARVAN) {
    const configured = isCloudProviderConfigured(InfrastructureProvider.ARVAN);
    return { configured, capabilities: providerCapabilities(InfrastructureProvider.ARVAN) };
  }
  if (service === ServiceConnectionName.PARSPACK) {
    const configured = isCloudProviderConfigured(InfrastructureProvider.PARSPACK);
    return { configured, capabilities: providerCapabilities(InfrastructureProvider.PARSPACK) };
  }
  if (service === ServiceConnectionName.KAVENEGAR) {
    const configured =
      env.smsProvider === "kavenegar" &&
      Boolean(env.kavenegarApiKey.trim()) &&
      Boolean(env.kavenegarTemplate.trim());
    return { configured, capabilities: kavenegarCapabilities(configured) };
  }
  const payment = await paymentConfiguration();
  return { configured: payment.configured, capabilities: paymentCapabilities(payment.configured) };
}

function viewFrom(
  service: ServiceConnectionName,
  derived: Awaited<ReturnType<typeof derivedConnection>>,
  stored?: ServiceConnectionCheck | null,
): ServiceConnectionView {
  const status = !derived.configured
    ? ServiceConnectionCheckStatus.UNCONFIGURED
    : stored?.status ?? ServiceConnectionCheckStatus.UNVERIFIED;
  const message = !derived.configured
    ? "تنظیم نشده"
    : stored?.message ?? "تنظیم شده؛ بررسی اتصال اجرا نشده است";
  return {
    service,
    label: serviceLabels[service],
    configured: derived.configured,
    status,
    message,
    checkedAt: stored?.checkedAt.toISOString() ?? null,
    errorCode: stored?.errorCode ?? null,
    capabilities: derived.capabilities,
  };
}

export async function getServiceConnectionsAdminView(): Promise<ServiceConnectionView[]> {
  const services = Object.values(ServiceConnectionName);
  const [stored, ...derived] = await Promise.all([
    prisma.serviceConnectionCheck.findMany(),
    ...services.map((service) => derivedConnection(service)),
  ]);
  return services.map((service, index) =>
    viewFrom(
      service,
      derived[index],
      stored.find((entry) => entry.service === service),
    ),
  );
}

export async function runServiceConnectionCheck(service: ServiceConnectionName) {
  const derived = await derivedConnection(service);
  const checkedAt = new Date();
  let status: ServiceConnectionCheckStatus = ServiceConnectionCheckStatus.UNCONFIGURED;
  let message = "تنظیم نشده";
  let errorCode: string | null = null;

  if (derived.configured) {
    if (service === ServiceConnectionName.ARVAN || service === ServiceConnectionName.PARSPACK) {
      try {
        const provider = service === ServiceConnectionName.ARVAN
          ? InfrastructureProvider.ARVAN
          : InfrastructureProvider.PARSPACK;
        const adapter = createCloudProviderAdapter(provider, "v1");
        const regions = await adapter.syncRegions();
        if (regions.length === 0) {
          status = ServiceConnectionCheckStatus.ERROR;
          message = "هیچ Region قابل استفاده‌ای دریافت نشد.";
          errorCode = "contract_mismatch";
        } else {
          status = ServiceConnectionCheckStatus.HEALTHY;
          message = "اتصال خواندنی با موفقیت بررسی شد.";
        }
      } catch (error) {
        const safe = toSafeConnectionFailure(error);
        status = ServiceConnectionCheckStatus.ERROR;
        message = safe.message;
        errorCode = safe.code;
      }
    } else if (service === ServiceConnectionName.KAVENEGAR) {
      status = ServiceConnectionCheckStatus.UNVERIFIED;
      message = "تنظیمات OTP معتبر است؛ برای جلوگیری از ارسال SMS، Probe شبکه اجرا نشد.";
    } else {
      await ensureGatewayConfigsSeeded();
      const payment = await paymentConfiguration();
      if (!payment.gateway || !payment.callbackValid) {
        status = ServiceConnectionCheckStatus.ERROR;
        message = "درگاه پیش‌فرض یا آدرس Callback معتبر نیست.";
        errorCode = "contract_mismatch";
      } else {
        const configuration = createProviderFor(payment.gateway.provider, {
          environment: payment.gateway.environment,
        }).validateConfiguration();
        status = configuration.ok
          ? ServiceConnectionCheckStatus.UNVERIFIED
          : ServiceConnectionCheckStatus.ERROR;
        message = configuration.ok
          ? "پیکربندی درگاه معتبر است؛ Probe مالی اجرا نشد."
          : "پیکربندی درگاه معتبر نیست.";
        errorCode = configuration.ok ? null : "contract_mismatch";
      }
    }
  }

  const stored = await prisma.serviceConnectionCheck.upsert({
    where: { service },
    update: { configured: derived.configured, status, capabilities: derived.capabilities, errorCode, message, checkedAt },
    create: { service, configured: derived.configured, status, capabilities: derived.capabilities, errorCode, message, checkedAt },
  });
  return viewFrom(service, derived, stored);
}
