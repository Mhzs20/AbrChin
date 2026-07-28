export type QuestionId =
  | "project"
  | "audience"
  | "stage"
  | "usage"
  | "criticality"
  | "management";

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
export type AnswerSource = "user" | "estimate" | "default";

export type RecommendationAnswers = Partial<{
  project: ProjectKind;
  audience: AudienceKind;
  stage: StageKind;
  usage: UsageKind;
  criticality: CriticalityKind;
  management: ManagementKind;
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
  deliveryMode: "RAW" | "MANAGED";
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
  profile: ResourceProfile;
  minimumProfile: ResourceProfile;
  confidence: RecommendationConfidence;
  reasons: string[];
  assumptions: RecommendationAssumption[];
  caveats: string[];
  architectureEscalation: boolean;
};

export type RecommendationDirection = "economy" | "balanced" | "performance";

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
