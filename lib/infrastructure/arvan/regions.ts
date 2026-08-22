import { InfrastructureError } from "../errors.ts";

const REGION_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_REGION_CODE_LENGTH = 64;

/**
 * Customer-facing region names. Provider identity — including Arvan's internal
 * datacenter codenames (سیمین، فروغ، بامداد، شهریار، قیصر، گوته) — must never
 * reach the customer, so every entry here is a real city plus a stable number.
 *
 * Tehran numbering shares one sequence with the ParsPack datacenters
 * (تهران ۲ / ۳ / ۱۱ in lib/cloud-servers/catalog.ts), so no two datacenters
 * ever carry the same customer name: Arvan holds ۱ / ۴ / ۵.
 *
 * eu-west1-a is deliberately the generic «اروپا» until the actual city is
 * confirmed — a wrong city name is worse than a broad one.
 */
const regionPresentation: Record<
  string,
  { label: string; shortLabel: string; country: string; sortOrder: number }
> = {
  "ir-thr-si1": {
    label: "تهران ۱، ایران",
    shortLabel: "تهران ۱",
    country: "ایران",
    sortOrder: 0,
  },
  "ir-thr-fr1": {
    label: "تهران ۴، ایران",
    shortLabel: "تهران ۴",
    country: "ایران",
    sortOrder: 1,
  },
  "ir-tbz-sh1": {
    label: "تبریز ۱، ایران",
    shortLabel: "تبریز ۱",
    country: "ایران",
    sortOrder: 2,
  },
  "ir-thr-ba1": {
    label: "تهران ۵، ایران",
    shortLabel: "تهران ۵",
    country: "ایران",
    sortOrder: 3,
  },
  "ir-southwest1-a": {
    label: "اهواز ۱، ایران",
    shortLabel: "اهواز ۱",
    country: "ایران",
    sortOrder: 4,
  },
  "eu-west1-a": {
    label: "اروپا",
    shortLabel: "اروپا",
    country: "—",
    sortOrder: 10,
  },
};

export type ArvanRegionPresentation = {
  label: string;
  shortLabel: string;
  country: string;
  sortOrder: number;
};

export function parseArvanRegionCodes(csv: string): string[] {
  const regions = csv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const region of regions) {
    if (
      region.length > MAX_REGION_CODE_LENGTH ||
      !REGION_CODE_PATTERN.test(region)
    ) {
      throw new InfrastructureError(
        "provider_invalid_region_config",
        "Arvan region configuration is invalid",
      );
    }
  }

  return [...new Set(regions)];
}

export function requireArvanRegionCodes(csv: string): string[] {
  const regions = parseArvanRegionCodes(csv);
  if (regions.length === 0) {
    throw new InfrastructureError(
      "provider_invalid_region_config",
      "Arvan region configuration is required",
    );
  }
  return regions;
}

export function arvanRegionPresentation(
  regionCode: string,
): ArvanRegionPresentation {
  return (
    regionPresentation[regionCode] ?? {
      label: "موقعیت ابری",
      shortLabel: "موقعیت ابری",
      country: "—",
      sortOrder: 90,
    }
  );
}
