import { InfrastructureError } from "@/lib/infrastructure/errors";

const REGION_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_REGION_CODE_LENGTH = 64;

const regionPresentation: Record<
  string,
  { label: string; shortLabel: string; country: string; sortOrder: number }
> = {
  "ir-thr-si1": {
    label: "سیمین، غرب تهران",
    shortLabel: "سیمین",
    country: "ایران",
    sortOrder: 0,
  },
  "ir-thr-fr1": {
    label: "فروغ، شرق تهران",
    shortLabel: "فروغ",
    country: "ایران",
    sortOrder: 1,
  },
  "ir-tbz-sh1": {
    label: "شهریار، تبریز",
    shortLabel: "شهریار",
    country: "ایران",
    sortOrder: 2,
  },
  "ir-thr-ba1": {
    label: "بامداد، غرب تهران",
    shortLabel: "بامداد",
    country: "ایران",
    sortOrder: 3,
  },
  "ir-southwest1-a": {
    label: "قیصر، اهواز",
    shortLabel: "قیصر",
    country: "ایران",
    sortOrder: 4,
  },
  "eu-west1-a": {
    label: "گوته، آلمان",
    shortLabel: "گوته",
    country: "آلمان",
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
