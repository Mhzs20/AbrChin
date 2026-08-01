import {
  InfrastructureProvider,
  ParchinLevel,
  Prisma,
  RecommendationQuoteStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getCatalogFreshness,
  requestCatalogSync,
} from "@/lib/infrastructure/multi-provider-catalog-service";
import {
  resolveProviderSelectionDefaults,
  revalidateLockedSelection,
} from "@/lib/infrastructure/selection-revalidation";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import { assertPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import { listActivePlans } from "@/lib/orders/plans";
import {
  assertParchinLevelAllowed,
  recommendedParchinLevel,
} from "@/lib/parchin/recommendation";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import type { ProductFlowState } from "@/lib/product-flow/state-machine";
import { buildRecommendation } from "@/lib/recommendation/engine";
import { selectQuotes } from "@/lib/recommendation/quote-service";
import {
  ConversationRevisionConflictError,
  requireConversationAccess,
  serializeConversationSession,
} from "@/lib/recommendation/session-service";
import type {
  AnswerSources,
  RecommendationAnswers,
} from "@/lib/recommendation/types";
import { WalletError } from "@/lib/wallet/errors";

function asAnswers(value: Prisma.JsonValue): RecommendationAnswers {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecommendationAnswers)
    : {};
}

function asSources(value: Prisma.JsonValue): AnswerSources {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnswerSources)
    : {};
}

async function requireFreshArvanCatalog() {
  const freshness = await getCatalogFreshness(
    InfrastructureProvider.ARVAN,
  );
  if (!freshness.fresh) {
    await requestCatalogSync(InfrastructureProvider.ARVAN);
    throw new WalletError(
      "quote_unavailable",
      "کاتالوگ در حال به‌روزرسانی است؛ کمی بعد دوباره تلاش کن.",
    );
  }
}

export async function getConversationDeliveryOptions(input: {
  sessionId: string;
  userId?: string | null;
  guestToken?: string | null;
  requestedParchinLevel?: ParchinLevel;
}) {
  assertPublicSaleEnabled({
    provider: InfrastructureProvider.ARVAN,
    offerSource: "API_CATALOG",
  });
  const session = await requireConversationAccess(input);
  if (
    ![
      "REQUIREMENTS_COMPLETE",
      "RECOMMENDED",
      "PARCHIN_SELECTED",
      "DELIVERY_CONFIGURED",
      "QUOTED",
      "QUOTE_EXPIRED",
    ].includes(session.productFlowState ?? "")
  ) {
    throw new Error("conversation_requirements_not_confirmed");
  }
  await requireFreshArvanCatalog();
  const answers = asAnswers(session.answers);
  const sources = asSources(session.answerSources);
  const minimumParchinLevel = recommendedParchinLevel(answers);
  const selectedParchinLevel =
    input.requestedParchinLevel ??
    session.selectedParchinLevel ??
    minimumParchinLevel;
  assertParchinLevelAllowed(selectedParchinLevel, minimumParchinLevel);
  const recommendation = buildRecommendation(answers, sources);
  const now = new Date();
  const plans = await listActivePlans(selectedParchinLevel);
  const selected = selectQuotes(
    recommendation,
    plans,
    now,
    new Date(now.getTime() + 10 * 60 * 1000),
  );
  const catalogItemIds = [
    ...new Set(selected.map(({ plan }) => plan.catalogItemId).filter(Boolean)),
  ] as string[];
  const catalogItems = await prisma.providerCatalogItem.findMany({
    where: { id: { in: catalogItemIds } },
    select: { id: true, compatibleImageCodes: true },
  });
  const imageCodes = [
    ...new Set(
      catalogItems.flatMap((item) =>
        Array.isArray(item.compatibleImageCodes)
          ? item.compatibleImageCodes.filter(
              (code): code is string => typeof code === "string",
            )
          : [],
      ),
    ),
  ];
  const images = await prisma.providerCatalogAsset.findMany({
    where: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      kind: "IMAGE",
      externalId: { in: imageCodes },
      status: "ACTIVE",
      available: true,
    },
    orderBy: [{ regionCode: "asc" }, { name: "asc" }],
  });
  const itemById = new Map(catalogItems.map((item) => [item.id, item]));

  return {
    revision: session.revision,
    minimumParchinLevel,
    selectedParchinLevel,
    options: selected.map(({ role, plan }) => {
      const compatible = itemById.get(plan.catalogItemId ?? "")
        ?.compatibleImageCodes;
      const allowedCodes = Array.isArray(compatible)
        ? compatible.filter(
            (code): code is string => typeof code === "string",
          )
        : [];
      const planImages = images.filter(
        (image) =>
          image.regionCode === plan.regionCode &&
          allowedCodes.includes(image.externalId),
      );
      return {
        id: plan.id,
        role,
        region: plan.regionCode,
        title: plan.title,
        vcpu: plan.pricing.vcpu,
        ramGb: plan.pricing.ramGb,
        storageGb: plan.pricing.storageGb,
        images: planImages.map((image) => ({
          id: image.id,
          label: image.name,
          windows: /windows/i.test(image.name),
        })),
      };
    }),
  };
}

export async function configureConversationDelivery(input: {
  sessionId: string;
  expectedRevision: number;
  planId: string;
  imageAssetId: string;
  parchinLevel: ParchinLevel;
  accessMethod: "ONE_TIME_PASSWORD" | "SSH_KEY" | "WINDOWS_PASSWORD";
  sshKeyName?: string | null;
  userId?: string | null;
  guestToken?: string | null;
}) {
  assertPublicSaleEnabled({
    provider: InfrastructureProvider.ARVAN,
    offerSource: "API_CATALOG",
  });
  const session = await requireConversationAccess(input);
  if (session.revision !== input.expectedRevision) {
    throw new ConversationRevisionConflictError(session.revision);
  }
  const currentState = session.productFlowState ?? "DRAFT";
  if (
    ![
      "REQUIREMENTS_COMPLETE",
      "RECOMMENDED",
      "PARCHIN_SELECTED",
      "DELIVERY_CONFIGURED",
      "QUOTED",
      "QUOTE_EXPIRED",
    ].includes(currentState)
  ) {
    throw new Error("conversation_requirements_not_confirmed");
  }
  const answers = asAnswers(session.answers);
  const minimumParchinLevel = recommendedParchinLevel(answers);
  assertParchinLevelAllowed(input.parchinLevel, minimumParchinLevel);
  if (
    input.accessMethod === "SSH_KEY" &&
    !/^[a-zA-Z0-9._-]{1,128}$/.test(input.sshKeyName ?? "")
  ) {
    throw new Error("ssh_key_name_required");
  }
  await requireFreshArvanCatalog();
  const plan = (await listActivePlans(input.parchinLevel)).find(
    (candidate) => candidate.id === input.planId,
  );
  if (!plan || plan.provider !== InfrastructureProvider.ARVAN) {
    throw new WalletError(
      "quote_unavailable",
      "این چینش دیگر قابل فروش نیست.",
    );
  }
  const image = await prisma.providerCatalogAsset.findFirst({
    where: {
      id: input.imageAssetId,
      provider: InfrastructureProvider.ARVAN,
      apiVersion: plan.providerApiVersion,
      regionCode: plan.regionCode,
      kind: "IMAGE",
      status: "ACTIVE",
      available: true,
    },
  });
  const compatible = Array.isArray(
    plan.catalogItem.compatibleImageCodes,
  )
    ? plan.catalogItem.compatibleImageCodes.filter(
        (code): code is string => typeof code === "string",
      )
    : [];
  if (!image || !compatible.includes(image.externalId)) {
    throw new WalletError(
      "quote_unavailable",
      "سیستم‌عامل انتخاب‌شده با این سرور سازگار نیست.",
    );
  }
  const isWindows = /windows/i.test(image.name);
  const rawImage =
    image.rawPayload &&
    typeof image.rawPayload === "object" &&
    !Array.isArray(image.rawPayload)
      ? (image.rawPayload as Record<string, unknown>)
      : {};
  if (
    (isWindows && input.accessMethod !== "WINDOWS_PASSWORD") ||
    (!isWindows && input.accessMethod === "WINDOWS_PASSWORD") ||
    (input.accessMethod === "SSH_KEY" &&
      rawImage.ssh_key === false) ||
    (input.accessMethod === "ONE_TIME_PASSWORD" &&
      rawImage.ssh_password === false)
  ) {
    throw new Error("invalid_access_method_for_image");
  }
  const defaults = await resolveProviderSelectionDefaults({
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion,
    productKind: plan.productKind,
    region: plan.regionCode,
  });
  const lockedSshKey =
    input.accessMethod === "SSH_KEY"
      ? (
          await createCloudProviderAdapter(
            plan.provider,
            plan.providerApiVersion,
          ).listSshKeys(plan.regionCode)
        ).find((key) => key.name === input.sshKeyName)
      : null;
  if (input.accessMethod === "SSH_KEY" && !lockedSshKey) {
    throw new Error("ssh_key_not_found");
  }
  const externalPlanId =
    plan.catalogItem.externalPlanId ?? plan.sizeCode;
  const currentPrice = await revalidateLockedSelection({
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion,
    productKind: plan.productKind,
    region: plan.regionCode,
    externalPlanId,
    externalImageId: image.externalId,
    externalNetworkId: defaults.externalNetworkId,
    externalSecurityId: defaults.externalSecurityId,
  });
  if (
    currentPrice.monthlyPriceIrr !==
    plan.pricing.providerBasePriceRial
  ) {
    await requestCatalogSync(InfrastructureProvider.ARVAN);
    throw new WalletError(
      "quote_revalidation_failed",
      "قیمت تغییر کرده و کاتالوگ در حال به‌روزرسانی است.",
    );
  }
  const configuration = {
    provider: plan.provider,
    providerApiVersion: plan.providerApiVersion,
    productKind: plan.productKind,
    planId: plan.id,
    catalogItemId: plan.catalogItemId,
    region: plan.regionCode,
    regionLabel: plan.regionCode,
    externalPlanId,
    externalImageId: image.externalId,
    imageAssetId: image.id,
    operatingSystem: image.name,
    accessMethod: input.accessMethod,
    sshKeyName:
      input.accessMethod === "SSH_KEY" ? lockedSshKey?.name : null,
    sshKeyId:
      input.accessMethod === "SSH_KEY" ? lockedSshKey?.id : null,
    sshKeyFingerprint:
      input.accessMethod === "SSH_KEY"
        ? lockedSshKey?.fingerprint
        : null,
    startupScriptCode: null,
    backupAddon: null,
    externalNetworkId: defaults.externalNetworkId,
    externalSecurityId: defaults.externalSecurityId,
    topologyVerificationMode: defaults.topologyVerificationMode,
    configuredAt: currentPrice.checkedAt.toISOString(),
  } satisfies Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    await tx.recommendationQuote.updateMany({
      where: {
        sessionId: session.id,
        status: {
          in: [
            RecommendationQuoteStatus.ACTIVE,
            RecommendationQuoteStatus.SELECTED,
          ],
        },
      },
      data: { status: RecommendationQuoteStatus.INVALIDATED },
    });
    const changed = await tx.recommendationSession.updateMany({
      where: {
        id: session.id,
        revision: input.expectedRevision,
      },
      data: {
        selectedParchinLevel: input.parchinLevel,
        deliveryConfiguration: configuration,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.recommendationSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { revision: true },
      });
      throw new ConversationRevisionConflictError(latest.revision);
    }

    let state = currentState as ProductFlowState;
    if (state !== "REQUIREMENTS_COMPLETE") {
      await transitionProductFlowTx(tx, {
        owner: { recommendationSessionId: session.id },
        from: state,
        to: "REQUIREMENTS_COMPLETE",
        reason: "delivery_configuration_revised",
        idempotencyKey: `delivery-reset:${session.id}:${input.expectedRevision + 1}`,
        actorUserId: input.userId ?? null,
      });
      state = "REQUIREMENTS_COMPLETE";
    }
    const flow = [
      ["REQUIREMENTS_COMPLETE", "RECOMMENDED"],
      ["RECOMMENDED", "PARCHIN_SELECTED"],
      ["PARCHIN_SELECTED", "DELIVERY_CONFIGURED"],
    ] as const;
    for (const [index, [from, to]] of flow.entries()) {
      await transitionProductFlowTx(tx, {
        owner: { recommendationSessionId: session.id },
        from,
        to,
        reason:
          to === "DELIVERY_CONFIGURED"
            ? "customer_confirmed_delivery_configuration"
            : "customer_confirmed_recommendation",
        idempotencyKey: `delivery-flow:${session.id}:${input.expectedRevision + 1}:${index}`,
        actorUserId: input.userId ?? null,
        metadata:
          to === "DELIVERY_CONFIGURED"
            ? {
                planId: plan.id,
                imageAssetId: image.id,
                accessMethod: input.accessMethod,
                networkLocked: true,
                securityLocked: true,
              }
            : undefined,
      });
    }
  });
  return serializeConversationSession(session.id);
}
