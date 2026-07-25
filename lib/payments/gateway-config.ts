import {
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
  type PaymentGatewayConfig,
  type Prisma,
} from "@prisma/client";

import { prisma } from "../db.ts";
import { getEnv } from "../env.ts";
import { PaymentError } from "./errors.ts";
import { createProviderFor, hasServerCredentials } from "./provider-factory.ts";
import type { PaymentGatewayName } from "./types.ts";
import { providerEnumToSlug } from "./types.ts";

export type GatewayPublicView = {
  id: string;
  provider: PaymentGatewayProvider;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  environment: PaymentGatewayEnvironment;
  minAmountRial: string | null;
  maxAmountRial: string | null;
  description: string | null;
  updatedAt: string;
  updatedBy: { id: string; mobile: string; displayName: string | null } | null;
  serverConfigured: boolean;
  canEnable: boolean;
  configurationMessage: string | null;
};

export type GatewayConfigSnapshot = {
  id: string;
  provider: PaymentGatewayProvider;
  displayName: string;
  environment: PaymentGatewayEnvironment;
  priority: number;
  enabled: boolean;
  isDefault: boolean;
};

type AuditContext = {
  actorUserId: string;
  ip?: string | null;
  userAgent?: string | null;
};

function bootstrapDefaultProvider(): PaymentGatewayProvider {
  const raw = (process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER || "zibal").toLowerCase();
  if (raw === "zarinpal") return PaymentGatewayProvider.ZARINPAL;
  if (raw === "mock" && !getEnv().isProduction) return PaymentGatewayProvider.MOCK;
  return PaymentGatewayProvider.ZIBAL;
}

function seedRows() {
  const defaultProvider = bootstrapDefaultProvider();
  const isProduction = getEnv().isProduction;

  const rows = [
    {
      provider: PaymentGatewayProvider.ZIBAL,
      displayName: "زیبال",
      enabled: true,
      isDefault: defaultProvider === PaymentGatewayProvider.ZIBAL,
      priority: 10,
      environment: PaymentGatewayEnvironment.PRODUCTION,
      description: "درگاه پیش‌فرض Production ابرچین",
    },
    {
      provider: PaymentGatewayProvider.ZARINPAL,
      displayName: "زرین‌پال",
      enabled: false,
      isDefault: defaultProvider === PaymentGatewayProvider.ZARINPAL,
      priority: 20,
      environment: isProduction
        ? PaymentGatewayEnvironment.PRODUCTION
        : PaymentGatewayEnvironment.SANDBOX,
      description: "درگاه جایگزین",
    },
    {
      provider: PaymentGatewayProvider.MOCK,
      displayName: "آزمایشی",
      enabled: !isProduction && defaultProvider === PaymentGatewayProvider.MOCK,
      isDefault: !isProduction && defaultProvider === PaymentGatewayProvider.MOCK,
      priority: 100,
      environment: PaymentGatewayEnvironment.DEVELOPMENT,
      description: "فقط Development/Test",
    },
  ];

  let sawDefault = false;
  for (const row of rows) {
    if (row.isDefault) {
      if (sawDefault) row.isDefault = false;
      else sawDefault = true;
    }
  }
  if (!sawDefault) {
    rows[0].isDefault = true;
    rows[0].enabled = true;
  }
  return rows;
}

export async function ensureGatewayConfigsSeeded() {
  const existing = await prisma.paymentGatewayConfig.findMany();
  if (existing.length > 0) return existing;

  const rows = seedRows();
  await prisma.$transaction(rows.map((row) => prisma.paymentGatewayConfig.create({ data: row })));
  return prisma.paymentGatewayConfig.findMany({ orderBy: { priority: "asc" } });
}

export function toPublicGatewayView(
  config: PaymentGatewayConfig & {
    updatedBy?: { id: string; mobile: string; displayName: string | null } | null;
  },
): GatewayPublicView {
  const serverConfigured = hasServerCredentials(config.provider);
  const canEnable =
    serverConfigured &&
    !(getEnv().isProduction && config.provider === PaymentGatewayProvider.MOCK);

  return {
    id: config.id,
    provider: config.provider,
    displayName: config.displayName,
    enabled: config.enabled,
    isDefault: config.isDefault,
    priority: config.priority,
    environment: config.environment,
    minAmountRial: config.minAmountRial?.toString() ?? null,
    maxAmountRial: config.maxAmountRial?.toString() ?? null,
    description: config.description,
    updatedAt: config.updatedAt.toISOString(),
    updatedBy: config.updatedBy
      ? {
          id: config.updatedBy.id,
          mobile: config.updatedBy.mobile,
          displayName: config.updatedBy.displayName,
        }
      : null,
    serverConfigured,
    canEnable,
    configurationMessage: serverConfigured ? null : "اطلاعات اتصال روی سرور تنظیم نشده است",
  };
}

export function buildGatewaySnapshot(config: PaymentGatewayConfig): GatewayConfigSnapshot {
  return {
    id: config.id,
    provider: config.provider,
    displayName: config.displayName,
    environment: config.environment,
    priority: config.priority,
    enabled: config.enabled,
    isDefault: config.isDefault,
  };
}

export async function listGatewayConfigs() {
  await ensureGatewayConfigsSeeded();
  const rows = await prisma.paymentGatewayConfig.findMany({
    include: { updatedBy: { select: { id: true, mobile: true, displayName: true } } },
    orderBy: { priority: "asc" },
  });
  return rows.map(toPublicGatewayView);
}

export async function getDefaultGatewayConfig() {
  await ensureGatewayConfigsSeeded();
  return prisma.paymentGatewayConfig.findFirst({
    where: { enabled: true, isDefault: true },
  });
}

export async function getGatewayConfigByProvider(provider: PaymentGatewayProvider) {
  await ensureGatewayConfigsSeeded();
  return prisma.paymentGatewayConfig.findUnique({ where: { provider } });
}

function serializeConfig(config: PaymentGatewayConfig): Prisma.InputJsonValue {
  return {
    provider: config.provider,
    displayName: config.displayName,
    enabled: config.enabled,
    isDefault: config.isDefault,
    priority: config.priority,
    environment: config.environment,
    minAmountRial: config.minAmountRial?.toString() ?? null,
    maxAmountRial: config.maxAmountRial?.toString() ?? null,
    description: config.description,
  };
}

export async function updateGatewayConfig(params: {
  provider: PaymentGatewayProvider;
  enabled?: boolean;
  priority?: number;
  environment?: PaymentGatewayEnvironment;
  audit: AuditContext;
}) {
  await ensureGatewayConfigsSeeded();

  return prisma.$transaction(async (tx) => {
    const current = await tx.paymentGatewayConfig.findUniqueOrThrow({
      where: { provider: params.provider },
    });
    const before = serializeConfig(current);

    const nextEnabled = params.enabled ?? current.enabled;
    const nextPriority = params.priority ?? current.priority;
    const nextEnvironment = params.environment ?? current.environment;

    if (nextEnabled && !hasServerCredentials(params.provider)) {
      throw new PaymentError("configuration", "اطلاعات اتصال روی سرور تنظیم نشده است");
    }

    if (getEnv().isProduction && params.provider === PaymentGatewayProvider.MOCK && nextEnabled) {
      throw new PaymentError("invalid_environment", "درگاه آزمایشی در Production قابل فعال‌سازی نیست.");
    }

    if (current.isDefault && nextEnabled === false) {
      throw new PaymentError(
        "default_locked",
        "درگاه پیش‌فرض را نمی‌توان غیرفعال کرد؛ ابتدا درگاه دیگری را پیش‌فرض کنید.",
      );
    }

    if (getEnv().isProduction && current.enabled && nextEnabled === false) {
      const remaining = await tx.paymentGatewayConfig.count({
        where: {
          enabled: true,
          provider: {
            notIn: [PaymentGatewayProvider.MOCK, params.provider],
          },
        },
      });
      if (remaining < 1) {
        throw new PaymentError("last_gateway", "حداقل یک درگاه Production باید فعال بماند.");
      }
    }

    const updated = await tx.paymentGatewayConfig.update({
      where: { id: current.id },
      data: {
        enabled: nextEnabled,
        priority: nextPriority,
        environment: nextEnvironment,
        updatedById: params.audit.actorUserId,
      },
    });

    await tx.paymentGatewayAuditLog.create({
      data: {
        gatewayConfigId: updated.id,
        actorUserId: params.audit.actorUserId,
        action: "update",
        beforeData: before,
        afterData: serializeConfig(updated),
        ip: params.audit.ip ?? null,
        userAgent: params.audit.userAgent ?? null,
      },
    });

    return updated;
  });
}

export async function makeGatewayDefault(params: {
  provider: PaymentGatewayProvider;
  audit: AuditContext;
}) {
  await ensureGatewayConfigsSeeded();

  return prisma.$transaction(async (tx) => {
    const target = await tx.paymentGatewayConfig.findUniqueOrThrow({
      where: { provider: params.provider },
    });

    if (!hasServerCredentials(params.provider)) {
      throw new PaymentError("configuration", "اطلاعات اتصال روی سرور تنظیم نشده است");
    }

    if (getEnv().isProduction && params.provider === PaymentGatewayProvider.MOCK) {
      throw new PaymentError("invalid_environment", "درگاه آزمایشی در Production قابل پیش‌فرض شدن نیست.");
    }

    const previousDefault = await tx.paymentGatewayConfig.findFirst({
      where: { isDefault: true },
    });

    await tx.paymentGatewayConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false, updatedById: params.audit.actorUserId },
    });

    const updated = await tx.paymentGatewayConfig.update({
      where: { id: target.id },
      data: {
        isDefault: true,
        enabled: true,
        updatedById: params.audit.actorUserId,
      },
    });

    if (previousDefault && previousDefault.id !== updated.id) {
      const previousAfter = serializeConfig({ ...previousDefault, isDefault: false });
      await tx.paymentGatewayAuditLog.create({
        data: {
          gatewayConfigId: previousDefault.id,
          actorUserId: params.audit.actorUserId,
          action: "unset_default",
          beforeData: serializeConfig(previousDefault),
          afterData: previousAfter,
          ip: params.audit.ip ?? null,
          userAgent: params.audit.userAgent ?? null,
        },
      });
    }

    await tx.paymentGatewayAuditLog.create({
      data: {
        gatewayConfigId: updated.id,
        actorUserId: params.audit.actorUserId,
        action: "make_default",
        beforeData: serializeConfig(target),
        afterData: serializeConfig(updated),
        ip: params.audit.ip ?? null,
        userAgent: params.audit.userAgent ?? null,
      },
    });

    return updated;
  });
}

export function gatewayDisplayLabel(provider: PaymentGatewayProvider | PaymentGatewayName): string {
  const slug =
    provider === "ZIBAL" || provider === "ZARINPAL" || provider === "MOCK"
      ? providerEnumToSlug(provider)
      : (provider as PaymentGatewayName);
  if (slug === "zibal") return "زیبال";
  if (slug === "zarinpal") return "زرین‌پال";
  return "آزمایشی";
}

export function validateProviderInstance(provider: PaymentGatewayProvider) {
  return createProviderFor(provider).validateConfiguration();
}
