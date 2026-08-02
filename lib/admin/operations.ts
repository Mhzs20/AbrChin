export type AdminOperationQueue = "provision" | "delivery" | "attention" | null;

export function classifyAdminOperationQueue(input: {
  status: string;
  productFlowState: string | null;
}): AdminOperationQueue {
  if (
    [
      "BLOCKED_PROVIDER_BALANCE",
      "NEEDS_RECONCILIATION",
      "MANUAL_REVIEW",
      "FAILED",
    ].includes(input.status) ||
    [
      "PROVISIONING_RETRYABLE",
      "PROVISIONING_RECONCILING",
      "PROVISIONING_MANUAL_REVIEW",
      "HEALTH_CHECK_FAILED",
      "DELIVERY_RETRYABLE",
    ].includes(input.productFlowState ?? "")
  ) {
    return "attention";
  }
  if (
    input.status === "WAITING_ADMIN_FUNDING" ||
    input.status === "FUNDING_CONFIRMED"
  ) {
    return "provision";
  }
  if (
    input.productFlowState === "WAITING_ADMIN_DELIVERY_APPROVAL" ||
    input.productFlowState === "DELIVERED"
  ) {
    return "delivery";
  }
  return null;
}
