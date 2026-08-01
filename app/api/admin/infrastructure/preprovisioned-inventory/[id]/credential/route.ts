import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { IdempotencyConflictError } from "@/lib/idempotency";
import { storePreprovisionedInventoryCredential } from "@/lib/infrastructure/preprovisioned-inventory";
import { credentialFingerprint } from "@/lib/security/credential-vault";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const { id: inventoryItemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (
      !/^[a-z_][a-z0-9_-]{0,31}$/i.test(username) ||
      secret.length < 8 ||
      secret.length > 4_096 ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      return jsonError("نام کاربری، Credential یا دلیل معتبر نیست.", 400);
    }
    const secretFingerprint = credentialFingerprint(secret);
    const command = normalizeAdminCommand({
      operation: "PREPROVISIONED_INVENTORY_CREDENTIAL_UPSERT",
      idempotencyKey,
      actorUserId: admin.id,
      reason,
      payload: {
        inventoryItemId,
        username,
        secretFingerprint,
      },
    });
    const meta = await readRequestMeta(request);
    const result = await prisma.$transaction(async (tx) => {
      await assertAdminActorTx(tx, admin.id);
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return { snapshot: replay, replay: true };
      const credential = await storePreprovisionedInventoryCredential({
        inventoryItemId,
        actorUserId: admin.id,
        username,
        secret,
        tx,
      });
      const snapshot = {
        inventoryItemId,
        credentialId: credential.id,
        status: credential.status,
        username: credential.username,
      };
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.PREPROVISIONED_INVENTORY_CREDENTIAL_UPSERT,
          entityType: "preprovisioned_inventory_credential",
          entityId: credential.id,
          afterData: {
            inventoryItemId,
            status: credential.status,
            username: credential.username,
            requestFingerprint: command.requestFingerprint,
            containsSecret: false,
          },
          idempotencyKey: `audit:${command.receiptKey}`,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, snapshot);
      return { snapshot, replay: false };
    });
    return jsonOk({ credential: result.snapshot, replay: result.replay });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنهٔ درخواست معتبر نیست.", 400);
    }
    return jsonError("ثبت Credential امن موجودی ممکن نیست.", 500);
  }
}
