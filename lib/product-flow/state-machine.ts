export const productFlowStates = [
  "ENTRY",
  "DISCOVERY",
  "PROFILE_REVIEW",
  "COMPARING",
  "QUOTED",
  "CONFIGURING",
  "AUTHENTICATING",
  "CHECKOUT",
  "PAYMENT_PENDING",
  "PAID",
  "WAITING_PROVIDER_FUNDING",
  "PROVISIONING",
  "RECONCILING",
  "HEALTH_CHECK",
  "SECURE_DELIVERY",
  "ACTIVE",
  "RENEWAL_DUE",
  "SUSPENDED",
  "TERMINATED",
  "ESCALATED",
  "EXPIRED",
  "FAILED",
] as const;

export type ProductFlowState = (typeof productFlowStates)[number];

const transitions: Record<ProductFlowState, readonly ProductFlowState[]> = {
  ENTRY: ["DISCOVERY"],
  DISCOVERY: ["PROFILE_REVIEW", "ESCALATED"],
  PROFILE_REVIEW: ["DISCOVERY", "COMPARING", "ESCALATED"],
  COMPARING: ["QUOTED", "PROFILE_REVIEW", "FAILED"],
  QUOTED: ["CONFIGURING", "PROFILE_REVIEW", "EXPIRED"],
  CONFIGURING: ["QUOTED", "AUTHENTICATING", "CHECKOUT", "EXPIRED"],
  AUTHENTICATING: ["CHECKOUT", "CONFIGURING", "EXPIRED"],
  CHECKOUT: ["PAYMENT_PENDING", "QUOTED", "EXPIRED"],
  PAYMENT_PENDING: ["PAID", "CHECKOUT", "FAILED", "EXPIRED"],
  PAID: ["WAITING_PROVIDER_FUNDING", "PROVISIONING"],
  WAITING_PROVIDER_FUNDING: ["PROVISIONING", "FAILED"],
  PROVISIONING: ["RECONCILING", "HEALTH_CHECK", "FAILED"],
  RECONCILING: ["PROVISIONING", "HEALTH_CHECK", "FAILED"],
  HEALTH_CHECK: ["SECURE_DELIVERY", "PROVISIONING", "ESCALATED", "FAILED"],
  SECURE_DELIVERY: ["ACTIVE", "ESCALATED"],
  ACTIVE: ["RENEWAL_DUE", "SUSPENDED", "TERMINATED"],
  RENEWAL_DUE: ["ACTIVE", "SUSPENDED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
  ESCALATED: ["DISCOVERY", "PROFILE_REVIEW", "PROVISIONING", "HEALTH_CHECK", "FAILED"],
  EXPIRED: ["COMPARING"],
  FAILED: ["COMPARING", "CHECKOUT", "PROVISIONING", "RECONCILING", "ESCALATED"],
};

export function canTransitionProductFlow(
  from: ProductFlowState,
  to: ProductFlowState,
): boolean {
  return transitions[from].includes(to);
}

export function assertProductFlowTransition(
  from: ProductFlowState,
  to: ProductFlowState,
): void {
  if (!canTransitionProductFlow(from, to)) {
    throw new Error(`invalid_product_flow_transition:${from}:${to}`);
  }
}

export function nextProductFlowStates(state: ProductFlowState): readonly ProductFlowState[] {
  return transitions[state];
}
