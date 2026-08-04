export type QuestionId =
  | "project"
  | "audience"
  | "stage"
  | "usage"
  | "architecture"
  | "storage"
  | "growth"
  | "downtime"
  | "criticality"
  | "management"
  | "budget"
  | "stack"
  | "domainReady"
  | "staging"
  | "dataResidency";

export type ProjectKind =
  | "site"
  | "commerce"
  | "product"
  | "api"
  | "migration"
  | "data"
  | "other";

export type AudienceKind = "iran" | "mixed" | "abroad" | "unknown";
export type StageKind = "idea" | "launch" | "active" | "growing" | "migration";
export type UsageKind = "starting" | "light" | "daily" | "busy" | "unknown";
export type CriticalityKind = "low" | "medium" | "high" | "severe" | "unknown";
export type ManagementKind = "raw" | "managed" | "unknown";
export type BudgetKind = "under_500k" | "500k_2m" | "2m_5m" | "over_5m" | "unknown";
export type StackKind = "wordpress" | "laravel" | "node" | "docker" | "windows" | "custom" | "unknown";
export type DomainReadyKind = "yes" | "no" | "unknown";
export type StagingKind = "yes" | "no" | "unknown";
export type DataResidencyKind = "iran_only" | "flexible" | "unknown";
export type ArchitectureKind = "single" | "app_db" | "multi_service" | "data_heavy" | "unknown";
export type StorageKind = "small" | "medium" | "large" | "unknown";
export type GrowthKind = "stable" | "campaign" | "rapid" | "unknown";
export type DowntimeKind = "flexible" | "short" | "near_zero" | "unknown";
export type AnswerSource = "user" | "estimate" | "default";

export type RecommendationAnswers = Partial<{
  project: ProjectKind;
  audience: AudienceKind;
  stage: StageKind;
  usage: UsageKind;
  architecture: ArchitectureKind;
  storage: StorageKind;
  growth: GrowthKind;
  downtime: DowntimeKind;
  criticality: CriticalityKind;
  management: ManagementKind;
  budget: BudgetKind;
  stack: StackKind;
  domainReady: DomainReadyKind;
  staging: StagingKind;
  dataResidency: DataResidencyKind;
}>;

export type AnswerSources = Partial<Record<QuestionId, AnswerSource>>;

export type QuestionOption = {
  value: string;
  label: string;
  description: string;
  icon:
    | "backup"
    | "compute"
    | "growth"
    | "location"
    | "managed-shield"
    | "question-help"
    | "raw-server"
    | "storage"
    | "support"
    | "traffic"
    | "warning";
};

export type RecommendationQuestion = {
  id: QuestionId;
  stepLabel: string;
  prompt: string;
  helper: string;
  explanation: string;
  example: string;
  decisionEffect: string;
  unknownNote: string;
  options: QuestionOption[];
};

export type ResourceProfile = {
  vcpu: number;
  ramGb: number;
  storageGb: number;
  regionPreference: "IRAN";
  deliveryMode: "MANAGED";
  backupPolicy: "NONE" | "WEEKLY" | "DAILY";
  needsResize: boolean;
};

export type RecommendationAssumption = {
  field: string;
  label: string;
  value: string;
  reason: string;
  source: Exclude<AnswerSource, "user">;
};

export type RecommendationConfidence = "high" | "medium" | "low";

export type RecommendationResult = {
  title: string;
  summary: string;
  workloadLabel: string;
  workloadClassification:
    | "GENERAL_LINUX"
    | "WINDOWS"
    | "WEB_APPLICATION"
    | "ECOMMERCE"
    | "DATABASE"
    | "CONTAINER"
    | "API"
    | "WORKER"
    | "AI_LIGHT"
    | "CUSTOM";
  profile: ResourceProfile;
  minimumProfile: ResourceProfile;
  confidence: RecommendationConfidence;
  reasons: string[];
  assumptions: RecommendationAssumption[];
  caveats: string[];
  architectureEscalation: boolean;
};

export type RecommendationDirection = "economy" | "balanced" | "performance";

export type RecommendationOfferRole = "ECONOMY" | "RECOMMENDED" | "GROWTH";

export type PublicRecommendationQuote = {
  id: string;
  role: RecommendationOfferRole;
  title: string;
  description: string | null;
  deliveryMode: "MANAGED";
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  amountRial: string;
  renewalAmountRial: string;
  termMonths: 1 | 3 | 6 | 12;
  termDiscountBps: number;
  couponCode: string | null;
  couponDiscountBps: number | null;
  lineItems: Array<{
    type: string;
    label: string;
    amountRial: string;
  }>;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  parchinLevel: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE";
  reasons: string[];
  expiresAt: string;
};

export type ProviderOffer = {
  id: string;
  planId: string;
  provider: "PARSPACK" | "ARVAN";
  providerLabel: string;
  regionCode: string;
  countryCode: "IR";
  deliveryModes: Array<"RAW" | "MANAGED">;
  vcpu: number;
  ramGb: number;
  storageGb: number;
  salePriceRial: number;
  available: boolean;
  supportsBackup: boolean;
  supportsResize: boolean;
  reliabilityScore: number;
  capturedAt: Date;
  expiresAt: Date;
};

export type RankedProviderOffer = ProviderOffer & {
  score: number;
  scoreBreakdown: {
    price: number;
    capacity: number;
    networkFit: number;
    capability: number;
    reliability: number;
  };
};

export type RejectedProviderOffer = {
  offer: ProviderOffer;
  reason:
    | "unavailable"
    | "expired"
    | "invalid_price"
    | "reliability_below_floor"
    | "region_mismatch"
    | "insufficient_resources"
    | "delivery_mode_mismatch"
    | "missing_backup";
};
