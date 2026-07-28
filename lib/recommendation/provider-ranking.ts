import type {
  ProviderOffer,
  RankedProviderOffer,
  RejectedProviderOffer,
  ResourceProfile,
} from "@/lib/recommendation/types";

const weights = {
  price: 0.35,
  capacity: 0.15,
  networkFit: 0.15,
  capability: 0.15,
  reliability: 0.2,
} as const;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function rejectReason(
  profile: ResourceProfile,
  offer: ProviderOffer,
  now: Date,
): RejectedProviderOffer["reason"] | null {
  if (!offer.available) return "unavailable";
  if (offer.expiresAt.getTime() <= now.getTime()) return "expired";
  if (!Number.isFinite(offer.salePriceRial) || offer.salePriceRial <= 0) return "invalid_price";
  if (!Number.isFinite(offer.reliabilityScore) || offer.reliabilityScore < 40) {
    return "reliability_below_floor";
  }
  if (profile.regionPreference === "IRAN" && offer.countryCode !== "IR") return "region_mismatch";
  if (
    offer.vcpu < profile.vcpu ||
    offer.ramGb < profile.ramGb ||
    offer.storageGb < profile.storageGb
  ) {
    return "insufficient_resources";
  }
  if (!offer.deliveryModes.includes(profile.deliveryMode)) return "delivery_mode_mismatch";
  if (profile.backupPolicy !== "NONE" && !offer.supportsBackup) return "missing_backup";
  return null;
}

export function rankProviderOffers(
  profile: ResourceProfile,
  offers: ProviderOffer[],
  now = new Date(),
): { ranked: RankedProviderOffer[]; rejected: RejectedProviderOffer[] } {
  const rejected: RejectedProviderOffer[] = [];
  const eligible = offers.filter((offer) => {
    const reason = rejectReason(profile, offer, now);
    if (reason) {
      rejected.push({ offer, reason });
      return false;
    }
    return true;
  });

  if (eligible.length === 0) return { ranked: [], rejected };

  const prices = eligible.map((offer) => offer.salePriceRial);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const ranked = eligible
    .map((offer): RankedProviderOffer => {
      const price =
        maxPrice === minPrice ? 100 : 100 - ((offer.salePriceRial - minPrice) / (maxPrice - minPrice)) * 100;
      const capacity = offer.available ? 100 : 0;
      const networkFit = offer.countryCode === "IR" ? 100 : 40;

      const requiredCapabilities = [
        profile.needsResize ? offer.supportsResize : true,
        profile.backupPolicy !== "NONE" ? offer.supportsBackup : true,
        offer.deliveryModes.includes(profile.deliveryMode),
      ];
      const capability =
        (requiredCapabilities.filter(Boolean).length / requiredCapabilities.length) * 100;
      const reliability = clampScore(offer.reliabilityScore);

      const scoreBreakdown = {
        price: roundScore(price),
        capacity: roundScore(capacity),
        networkFit: roundScore(networkFit),
        capability: roundScore(capability),
        reliability: roundScore(reliability),
      };

      const score = roundScore(
        scoreBreakdown.price * weights.price +
          scoreBreakdown.capacity * weights.capacity +
          scoreBreakdown.networkFit * weights.networkFit +
          scoreBreakdown.capability * weights.capability +
          scoreBreakdown.reliability * weights.reliability,
      );

      return { ...offer, score, scoreBreakdown };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.salePriceRial - b.salePriceRial ||
        b.capturedAt.getTime() - a.capturedAt.getTime(),
    );

  return { ranked, rejected };
}
