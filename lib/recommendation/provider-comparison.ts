import { rankProviderOffers } from "@/lib/recommendation/provider-ranking";
import type {
  ProviderOffer,
  RankedProviderOffer,
  RejectedProviderOffer,
  ResourceProfile,
} from "@/lib/recommendation/types";

export type QuoteProvider = ProviderOffer["provider"];

export interface ProviderOfferSource {
  readonly provider: QuoteProvider;
  fetchOffers(profile: ResourceProfile): Promise<ProviderOffer[]>;
}

export type ProviderComparisonStatus = {
  provider: QuoteProvider;
  ok: boolean;
  offerCount: number;
  safeMessage: string;
};

export type ProviderComparisonResult = {
  primary: RankedProviderOffer | null;
  ranked: RankedProviderOffer[];
  rejected: RejectedProviderOffer[];
  providers: ProviderComparisonStatus[];
  comparedAt: Date;
};

export async function compareProviderOffers(
  profile: ResourceProfile,
  sources: ProviderOfferSource[],
  now = new Date(),
): Promise<ProviderComparisonResult> {
  const settled = await Promise.allSettled(
    sources.map(async (source) => ({
      provider: source.provider,
      offers: await source.fetchOffers(profile),
    })),
  );

  const offers: ProviderOffer[] = [];
  const providers: ProviderComparisonStatus[] = settled.map((result, index) => {
    const provider = sources[index].provider;
    if (result.status === "rejected") {
      return {
        provider,
        ok: false,
        offerCount: 0,
        safeMessage: "این مسیر فعلاً پاسخ نمی‌دهد؛ تنظیماتت حفظ شده و می‌توانی مسیر دیگر را ببینی.",
      };
    }

    offers.push(...result.value.offers);
    return {
      provider,
      ok: true,
      offerCount: result.value.offers.length,
      safeMessage:
        result.value.offers.length > 0
          ? "قیمت و ظرفیت تازه دریافت شد."
          : "برای این چینش ظرفیت معتبری پیدا نشد.",
    };
  });

  const { ranked, rejected } = rankProviderOffers(profile, offers, now);
  return {
    primary: ranked[0] ?? null,
    ranked,
    rejected,
    providers,
    comparedAt: now,
  };
}
