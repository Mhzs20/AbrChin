export type AdminOperationQueue = "provision" | "delivery" | "attention" | null;

export function classifyAdminOperationQueue(input: {
  status: string;
  productFlowState: string | null;
}): AdminOperationQueue {
  if (input.status === "WAITING_ADMIN_FUNDING") return "provision";
  if (
    input.productFlowState === "WAITING_ADMIN_DELIVERY_APPROVAL" ||
    input.productFlowState === "DELIVERED"
  ) {
    return "delivery";
  }
  if (
    [
      "BLOCKED_PROVIDER_BALANCE",
      "NEEDS_RECONCILIATION",
      "MANUAL_REVIEW",
      "FAILED",
    ].includes(input.status)
  ) {
    return "attention";
  }
  return null;
}
