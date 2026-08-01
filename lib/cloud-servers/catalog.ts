import { arvanRegionPresentation } from "@/lib/infrastructure/arvan/regions";

export const READY_SERVER_PLAN_PREFIX = "READY_PARSPACK_";

const regionPresentation: Record<
  string,
  { label: string; shortLabel: string; country: string; sortOrder: number }
> = {
  tehran2: {
    label: "تهران ۲، ایران",
    shortLabel: "تهران ۲",
    country: "ایران",
    sortOrder: 0,
  },
  tehran3: {
    label: "تهران ۳، ایران",
    shortLabel: "تهران ۳",
    country: "ایران",
    sortOrder: 1,
  },
  tehran11: {
    label: "تهران ۱۱، ایران",
    shortLabel: "تهران ۱۱",
    country: "ایران",
    sortOrder: 2,
  },
  frankfurt: {
    label: "فرانکفورت، آلمان",
    shortLabel: "فرانکفورت",
    country: "آلمان",
    sortOrder: 10,
  },
  amsterdam: {
    label: "آمستردام، هلند",
    shortLabel: "آمستردام",
    country: "هلند",
    sortOrder: 11,
  },
  london1: {
    label: "لندن، بریتانیا",
    shortLabel: "لندن",
    country: "بریتانیا",
    sortOrder: 12,
  },
  istanbul: {
    label: "استانبول، ترکیه",
    shortLabel: "استانبول",
    country: "ترکیه",
    sortOrder: 13,
  },
  paris: {
    label: "پاریس، فرانسه",
    shortLabel: "پاریس",
    country: "فرانسه",
    sortOrder: 14,
  },
  stockholm: {
    label: "استکهلم، سوئد",
    shortLabel: "استکهلم",
    country: "سوئد",
    sortOrder: 15,
  },
  toronto2: {
    label: "تورنتو، کانادا",
    shortLabel: "تورنتو",
    country: "کانادا",
    sortOrder: 16,
  },
};

const imagePreference = [
  "ubuntu24-cloudinit-qcow2",
  "debian13-cloudinit-qcow2",
  "debian12-cloudinit-qcow2",
  "ubuntu22-cloudinit-qcow2",
] as const;

function safeCodePart(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function readyServerPlanCode(regionCode: string, sizeCode: string) {
  return `${READY_SERVER_PLAN_PREFIX}${safeCodePart(regionCode)}_${safeCodePart(sizeCode)}`;
}

export function isReadyServerPlanCode(code: string) {
  return code.startsWith(READY_SERVER_PLAN_PREFIX);
}

export function selectReadyServerImage(imageCodes: string[]) {
  for (const preferred of imagePreference) {
    if (imageCodes.includes(preferred)) return preferred;
  }
  return (
    imageCodes.find(
      (code) =>
        !code.startsWith("windows") &&
        !code.startsWith("mikrotik") &&
        !code.startsWith("cp-") &&
        !code.startsWith("da-") &&
        !code.startsWith("nc-"),
    ) ?? null
  );
}

export function readyServerLocation(regionCode: string) {
  return (
    regionPresentation[regionCode] ?? {
      ...arvanRegionPresentation(regionCode),
    }
  );
}

export function readyServerImageLabel(imageCode: string) {
  const labels: Record<string, string> = {
    "ubuntu24-cloudinit-qcow2": "Ubuntu 24 LTS",
    "ubuntu22-cloudinit-qcow2": "Ubuntu 22 LTS",
    "debian13-cloudinit-qcow2": "Debian 13",
    "debian12-cloudinit-qcow2": "Debian 12",
  };
  return labels[imageCode] ?? "Linux Cloud";
}

export function readyServerSortOrder(params: {
  regionCode: string;
  vcpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
}) {
  const region = readyServerLocation(params.regionCode).sortOrder;
  const resources =
    (params.vcpu ?? 0) * 10_000 +
    (params.ramMb ?? 0) * 10 +
    (params.diskGb ?? 0);
  return region * 1_000_000 + resources;
}

export function readyServerTitle(params: {
  regionCode: string;
  vcpu: number | null;
  ramMb: number | null;
}) {
  const location = readyServerLocation(params.regionCode).shortLabel;
  const ramGb = params.ramMb == null ? null : Math.ceil(params.ramMb / 1024);
  if (params.vcpu != null && ramGb != null) {
    return `ابر ${location} · ${params.vcpu} هسته / ${ramGb} گیگ`;
  }
  return `سرور ابری ${location}`;
}

export function readyServerDescription(params: {
  regionCode: string;
  imageCode: string;
}) {
  return `سرور ابری آماده در ${readyServerLocation(params.regionCode).label} با ${readyServerImageLabel(params.imageCode)} و پرچین پایه اجباری.`;
}
