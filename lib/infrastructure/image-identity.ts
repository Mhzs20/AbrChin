/**
 * Customer-facing OS identity normalization.
 *
 * Provider catalog assets often store naked version strings (e.g. "26.04")
 * with distribution metadata only in rawPayload. Never surface a naked
 * version to customers.
 */

export type CustomerImageIdentity = {
  displayName: string;
  distribution: string;
  version: string | null;
  architecture: string | null;
  /** Provider image id — internal only; do not render to customers. */
  providerImageId: string;
  windows: boolean;
};

type ImageIdentityInput = {
  name: string;
  externalId: string;
  rawPayload?: unknown;
  /** In-memory adapter field when available (not persisted on asset). */
  operatingSystem?: string | null;
};

const KNOWN_CODE_IDENTITIES: Record<
  string,
  Pick<CustomerImageIdentity, "distribution" | "version" | "displayName">
> = {
  "ubuntu24-cloudinit-qcow2": {
    distribution: "Ubuntu",
    version: "24.04",
    displayName: "Ubuntu 24.04 LTS",
  },
  "ubuntu22-cloudinit-qcow2": {
    distribution: "Ubuntu",
    version: "22.04",
    displayName: "Ubuntu 22.04 LTS",
  },
  "ubuntu20-cloudinit-qcow2": {
    distribution: "Ubuntu",
    version: "20.04",
    displayName: "Ubuntu 20.04 LTS",
  },
  "debian13-cloudinit-qcow2": {
    distribution: "Debian",
    version: "13",
    displayName: "Debian 13",
  },
  "debian12-cloudinit-qcow2": {
    distribution: "Debian",
    version: "12",
    displayName: "Debian 12",
  },
  "rocky9-cloudinit-qcow2": {
    distribution: "Rocky Linux",
    version: "9",
    displayName: "Rocky Linux 9",
  },
  "almalinux9-cloudinit-qcow2": {
    distribution: "AlmaLinux",
    version: "9",
    displayName: "AlmaLinux 9",
  },
};

const DISTRIBUTION_ALIASES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brocky(?:\s*linux)?\b/i, label: "Rocky Linux" },
  { pattern: /\balma(?:linux)?\b/i, label: "AlmaLinux" },
  { pattern: /\bcentos\b/i, label: "CentOS" },
  { pattern: /\bfedora\b/i, label: "Fedora" },
  { pattern: /\bdebian\b/i, label: "Debian" },
  { pattern: /\bubuntu\b/i, label: "Ubuntu" },
  { pattern: /\bwindows\b/i, label: "Windows" },
  { pattern: /\bopensuse\b/i, label: "openSUSE" },
  { pattern: /\bsuse\b/i, label: "SUSE" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function looksLikeNakedVersion(value: string): boolean {
  return /^\d+(\.\d+){0,2}([.-]?[a-z0-9]+)?$/i.test(value.trim());
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function resolveDistribution(parts: string[]): string | null {
  const haystack = parts.filter(Boolean).join(" ");
  for (const alias of DISTRIBUTION_ALIASES) {
    if (alias.pattern.test(haystack)) return alias.label;
  }
  return null;
}

function extractVersion(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (looksLikeNakedVersion(trimmed)) return trimmed;
    const dotted = trimmed.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
    if (dotted) return dotted[1];
    const major = trimmed.match(/\b(\d{1,2})\b/);
    if (major && /debian|rocky|alma|centos|fedora|windows/i.test(trimmed)) {
      return major[1];
    }
  }
  return null;
}

function ubuntuIsLts(version: string | null): boolean {
  if (!version) return false;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return Number.isFinite(major) && major % 2 === 0 && minor === 4;
}

function buildDisplayName(input: {
  distribution: string;
  version: string | null;
  architecture: string | null;
  windows: boolean;
}): string {
  const bits = [input.distribution];
  if (input.version) bits.push(input.version);
  if (
    input.distribution === "Ubuntu" &&
    input.version &&
    ubuntuIsLts(input.version) &&
    !/\bLTS\b/i.test(input.version)
  ) {
    bits.push("LTS");
  }
  if (input.architecture && !/x86_64|amd64/i.test(input.architecture)) {
    bits.push(input.architecture);
  }
  const display = bits.join(" ").replace(/\s+/g, " ").trim();
  if (looksLikeNakedVersion(display)) {
    return input.windows ? `Windows ${display}` : `Linux ${display}`;
  }
  return display;
}

/**
 * Normalize provider image metadata into a stable customer-facing identity.
 */
export function normalizeCustomerImageIdentity(
  input: ImageIdentityInput,
): CustomerImageIdentity {
  const known = KNOWN_CODE_IDENTITIES[input.externalId];
  const raw = asRecord(input.rawPayload);
  const nested =
    raw.rawPayload && typeof raw.rawPayload === "object"
      ? asRecord(raw.rawPayload)
      : {};
  const metadata = asRecord(raw.metadata ?? nested.metadata);
  const properties = asRecord(raw.properties ?? nested.properties);
  const image = asRecord(raw.image ?? nested.image);
  const os = asRecord(raw.os ?? nested.os);
  const sources = [raw, nested, metadata, properties, image, os];

  const stringFields = (keys: string[]) =>
    sources.flatMap((source) =>
      keys.map((key) => asString(source[key])).filter(Boolean),
    ) as string[];

  const distributionHints = [
    input.operatingSystem ?? null,
    ...stringFields([
      "distribution_name",
      "distributionName",
      "distribution",
      "operating_system",
      "operatingSystem",
      "os_description",
      "osDescription",
      "osFamily",
      "os_family",
      "display_name",
      "displayName",
      "image_name",
      "imageName",
      "title",
      "label",
      "slug",
      "group",
      "name",
    ]),
    input.name,
    input.externalId,
  ].filter(Boolean) as string[];

  const windows = distributionHints.some((value) => /windows/i.test(value));

  if (known && !windows) {
    return {
      displayName: known.displayName,
      distribution: known.distribution,
      version: known.version,
      architecture:
        asString(raw.architecture) ??
        asString(raw.arch) ??
        asString(nested.architecture) ??
        asString(nested.arch),
      providerImageId: input.externalId,
      windows: false,
    };
  }

  const distribution =
    resolveDistribution(distributionHints) ??
    (windows
      ? "Windows"
      : looksLikeNakedVersion(input.name)
        ? null
        : titleCaseWords(input.name.split(/[\d._-]/)[0] || "Linux"));

  const version = extractVersion([
    ...stringFields([
      "version",
      "os_version",
      "osVersion",
      "distribution_version",
      "distributionVersion",
      "operating_system_version",
      "operatingSystemVersion",
      "release",
      "release_name",
      "releaseName",
    ]),
    ...distributionHints,
    input.name,
    input.externalId.replace(/cloudinit|qcow2/gi, " "),
  ]);

  const architecture =
    asString(raw.architecture) ??
    asString(raw.arch) ??
    asString(nested.architecture) ??
    asString(nested.arch);

  const resolvedDistribution =
    distribution ??
    (windows ? "Windows" : version ? "Linux" : titleCaseWords(input.name) || "Linux");

  // Never return a naked version as the sole customer label.
  let displayName = buildDisplayName({
    distribution: resolvedDistribution,
    version,
    architecture,
    windows,
  });
  if (looksLikeNakedVersion(displayName) || displayName === version) {
    displayName = buildDisplayName({
      distribution: windows ? "Windows" : "Linux",
      version: version ?? displayName,
      architecture,
      windows,
    });
  }

  return {
    displayName,
    distribution: resolvedDistribution,
    version,
    architecture,
    providerImageId: input.externalId,
    windows,
  };
}

/** Storefront helper: normalize a plan imageCode into a customer label. */
export function customerImageLabelFromCode(imageCode: string): string {
  return normalizeCustomerImageIdentity({
    name: imageCode,
    externalId: imageCode,
  }).displayName;
}

const SERVER_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;

export function isValidCustomerServerName(value: string): boolean {
  const trimmed = value.trim().replace(/\s+/g, "-");
  if (trimmed.length < 2 || trimmed.length > 64) return false;
  if (!SERVER_NAME_PATTERN.test(trimmed)) return false;
  if (trimmed.includes("--")) return false;
  return true;
}

export function normalizeCustomerServerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, "-");
  if (!isValidCustomerServerName(trimmed)) return null;
  return trimmed;
}

export function generateCustomerServerName(randomBytes?: () => number): string {
  const rand = randomBytes ?? (() => Math.floor(Math.random() * 36));
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += alphabet[rand() % alphabet.length]!;
  }
  return `abrchin-${suffix}`;
}

/**
 * Customer self-serve SSH key registry does not exist yet.
 * Keep password delivery as the supported path; reject SSH at the boundary.
 */
export function isCustomerSshSelfServeEnabled(): boolean {
  return false;
}
