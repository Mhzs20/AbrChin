import { ServiceOrderStatus } from "@prisma/client";

export function isServiceReadyForProvision(status: ServiceOrderStatus) {
  return (
    status === ServiceOrderStatus.PAID ||
    status === ServiceOrderStatus.ACTIVATION_REQUESTED
  );
}
