import { prisma } from "@/lib/db";
import {
  DEFAULT_TOPUP_SUGGESTIONS_TOMAN,
  MAX_TOPUP_TOMAN,
  MIN_TOPUP_TOMAN,
  normalizeSuggestedAmounts,
} from "@/lib/wallet/topup-limits";

const SETTINGS_ID = "default";

function parseStoredSuggestions(value: unknown): number[] {
  try {
    return normalizeSuggestedAmounts(value);
  } catch {
    return [...DEFAULT_TOPUP_SUGGESTIONS_TOMAN];
  }
}

export async function ensureTopUpSettingsSeeded() {
  const existing = await prisma.walletTopUpSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;

  return prisma.walletTopUpSettings.create({
    data: {
      id: SETTINGS_ID,
      suggestedAmountsToman: [...DEFAULT_TOPUP_SUGGESTIONS_TOMAN],
    },
  });
}

export async function getTopUpSuggestedAmountsToman() {
  const settings = await prisma.walletTopUpSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  if (!settings) return [...DEFAULT_TOPUP_SUGGESTIONS_TOMAN];
  return parseStoredSuggestions(settings.suggestedAmountsToman);
}

export type TopUpSettingsView = {
  suggestedAmountsToman: number[];
  minTopUpToman: number;
  maxTopUpToman: number;
  updatedAt: string;
  updatedBy: { id: string; mobile: string; displayName: string | null } | null;
};

export async function getTopUpSettingsView(): Promise<TopUpSettingsView> {
  const settings = await prisma.walletTopUpSettings.findUnique({
    where: { id: SETTINGS_ID },
    include: { updatedBy: { select: { id: true, mobile: true, displayName: true } } },
  });
  if (!settings) {
    return {
      suggestedAmountsToman: [...DEFAULT_TOPUP_SUGGESTIONS_TOMAN],
      minTopUpToman: MIN_TOPUP_TOMAN,
      maxTopUpToman: MAX_TOPUP_TOMAN,
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
    };
  }

  return {
    suggestedAmountsToman: parseStoredSuggestions(settings.suggestedAmountsToman),
    minTopUpToman: MIN_TOPUP_TOMAN,
    maxTopUpToman: MAX_TOPUP_TOMAN,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy,
  };
}

export async function updateTopUpSuggestedAmounts(params: {
  suggestedAmountsToman: unknown;
  actorUserId: string;
}) {
  const amounts = normalizeSuggestedAmounts(params.suggestedAmountsToman);
  await ensureTopUpSettingsSeeded();

  return prisma.walletTopUpSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      suggestedAmountsToman: amounts,
      updatedById: params.actorUserId,
    },
  });
}

export {
  DEFAULT_TOPUP_SUGGESTIONS_TOMAN,
  MAX_TOPUP_TOMAN,
  MIN_TOPUP_TOMAN,
  normalizeSuggestedAmounts,
} from "@/lib/wallet/topup-limits";
