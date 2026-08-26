import type {
  MessageGoConnectionOwnership,
  MessageGoCustomerConnectionStatus,
} from "@prisma/client";

import type { OwnershipMode } from "@/lib/messagego/customer/handoff";

export type CustomerConnectionView = {
  id: string;
  account_id: string;
  product_id: string;
  workspace_id: string;
  alias: string;
  ownership_mode: OwnershipMode;
  family_alias: string | null;
  status: MessageGoCustomerConnectionStatus;
  last_handoff_at: string | null;
  last_error_code: string | null;
  secret_retained: false;
  raw_key_readable: false;
};

export function toCustomerConnectionView(row: {
  id: string;
  userId: string;
  productId: string;
  workspaceId: string;
  alias: string;
  ownershipMode: MessageGoConnectionOwnership;
  familyAlias: string | null;
  status: MessageGoCustomerConnectionStatus;
  lastHandoffAt: Date | null;
  lastErrorCode: string | null;
}): CustomerConnectionView {
  return {
    id: row.id,
    account_id: row.userId,
    product_id: row.productId,
    workspace_id: row.workspaceId,
    alias: row.alias,
    ownership_mode: row.ownershipMode,
    family_alias: row.familyAlias,
    status: row.status,
    last_handoff_at: row.lastHandoffAt?.toISOString() ?? null,
    last_error_code: row.lastErrorCode,
    secret_retained: false,
    raw_key_readable: false,
  };
}

export function customerViewContainsForbiddenSecret(
  view: unknown,
  secrets: string[],
) {
  const encoded = JSON.stringify(view);
  return secrets.some((secret) => secret && encoded.includes(secret));
}
