import {
  CloudInstanceStatus,
  InstanceCredentialStatus,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  decryptCredential,
  encryptCredential,
} from "@/lib/security/credential-vault";

const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/i;

export class InstanceCredentialError extends Error {
  readonly code:
    | "invalid_input"
    | "instance_not_ready"
    | "not_found"
    | "already_revealed"
    | "expired";

  constructor(
    code: InstanceCredentialError["code"],
    message: string,
  ) {
    super(message);
    this.name = "InstanceCredentialError";
    this.code = code;
  }
}

export async function storeInstanceCredential(params: {
  instanceId: string;
  adminUserId: string;
  username: string;
  secret: string;
  ttlHours?: number;
}) {
  const username = params.username.trim();
  const ttlHours = params.ttlHours ?? 24;
  if (
    !USERNAME_PATTERN.test(username) ||
    params.secret.length < 8 ||
    params.secret.length > 4_096 ||
    !Number.isInteger(ttlHours) ||
    ttlHours < 1 ||
    ttlHours > 168
  ) {
    throw new InstanceCredentialError("invalid_input", "اطلاعات دسترسی معتبر نیست.");
  }

  const instance = await prisma.cloudInstance.findUnique({
    where: { id: params.instanceId },
  });
  if (
    !instance ||
    !instance.ipv4 ||
    (!instance.healthCheckedAt &&
      instance.status !== CloudInstanceStatus.ACTIVE)
  ) {
    throw new InstanceCredentialError(
      "instance_not_ready",
      "سرور هنوز Health Check و دریافت IP را کامل نکرده است.",
    );
  }

  const encrypted = encryptCredential(params.secret);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1_000);
  const credential = await prisma.instanceCredential.upsert({
    where: { cloudInstanceId: instance.id },
    update: {
      createdById: params.adminUserId,
      username,
      ...encrypted,
      status: InstanceCredentialStatus.READY,
      expiresAt,
      revealedAt: null,
    },
    create: {
      cloudInstanceId: instance.id,
      createdById: params.adminUserId,
      username,
      ...encrypted,
      status: InstanceCredentialStatus.READY,
      expiresAt,
    },
  });
  return credential;
}

export async function revealInstanceCredential(params: {
  instanceId: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Test-only failure point proving audit and secret consumption are atomic. */
  testInjectFailureAfterAudit?: boolean;
}) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT credential.id
        FROM "InstanceCredential" credential
        JOIN "CloudInstance" instance
          ON instance.id = credential."cloudInstanceId"
        WHERE instance.id = ${params.instanceId}
        FOR UPDATE OF credential
      `;
      const credential = await tx.instanceCredential.findFirst({
        where: {
          cloudInstanceId: params.instanceId,
          cloudInstance: {
            userId: params.userId,
            status: CloudInstanceStatus.ACTIVE,
            infrastructureOrder: {
              status: "ACTIVE",
              productFlowState: "ACTIVE",
            },
          },
        },
        include: { cloudInstance: true },
      });
      if (!credential) {
        throw new InstanceCredentialError(
          "not_found",
          "اطلاعات دسترسی آماده نیست.",
        );
      }
      if (credential.expiresAt.getTime() <= Date.now()) {
        await tx.instanceCredential.updateMany({
          where: {
            id: credential.id,
            status: InstanceCredentialStatus.READY,
          },
          data: {
            status: InstanceCredentialStatus.EXPIRED,
            ciphertext: null,
            iv: null,
            authTag: null,
          },
        });
        throw new InstanceCredentialError(
          "expired",
          "مهلت دریافت اطلاعات دسترسی تمام شده است.",
        );
      }
      if (
        credential.status !== InstanceCredentialStatus.READY ||
        !credential.ciphertext ||
        !credential.iv ||
        !credential.authTag
      ) {
        throw new InstanceCredentialError(
          "already_revealed",
          "اطلاعات دسترسی قبلاً نمایش داده شده است.",
        );
      }
      const secret = decryptCredential({
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        authTag: credential.authTag,
      });
      await writeAuditLog(
        {
          actorUserId: params.userId,
          action: AuditActions.CREDENTIAL_REVEALED,
          entityType: "cloud_instance",
          entityId: params.instanceId,
          afterData: {
            credentialId: credential.id,
            revealed: true,
            containsSecret: false,
          },
          ip: params.ip,
          userAgent: params.userAgent,
          idempotencyKey: `credential-revealed:${credential.id}`,
        },
        tx,
      );
      if (params.testInjectFailureAfterAudit) {
        throw new Error("test_injected_after_credential_audit");
      }
      const claimed = await tx.instanceCredential.updateMany({
        where: {
          id: credential.id,
          status: InstanceCredentialStatus.READY,
          revealedAt: null,
        },
        data: {
          status: InstanceCredentialStatus.REVEALED,
          revealedAt: new Date(),
          ciphertext: null,
          iv: null,
          authTag: null,
        },
      });
      if (claimed.count !== 1) {
        throw new InstanceCredentialError(
          "already_revealed",
          "اطلاعات دسترسی قبلاً نمایش داده شده است.",
        );
      }
      return {
        username: credential.username,
        secret,
        ipv4: credential.cloudInstance.ipv4,
      };
    },
  );
}

/**
 * An Admin may inspect a prepared credential during the second approval. This
 * deliberately does not change its one-time customer state or emit its value;
 * callers must audit the protected, explicit reveal action themselves.
 */
export async function revealInstanceCredentialForAdmin(params: {
  instanceId: string;
}) {
  const credential = await prisma.instanceCredential.findFirst({
    where: {
      cloudInstanceId: params.instanceId,
      status: InstanceCredentialStatus.READY,
      cloudInstance: {
        status: CloudInstanceStatus.PENDING,
        infrastructureOrder: {
          productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
        },
      },
    },
    include: { cloudInstance: true },
  });
  if (
    !credential ||
    !credential.ciphertext ||
    !credential.iv ||
    !credential.authTag
  ) {
    throw new InstanceCredentialError(
      "not_found",
      "Credential آماده برای بازبینی نهایی وجود ندارد.",
    );
  }
  if (credential.expiresAt.getTime() <= Date.now()) {
    throw new InstanceCredentialError("expired", "مهلت Credential تمام شده است.");
  }
  return {
    username: credential.username,
    secret: decryptCredential({
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.authTag,
    }),
    ipv4: credential.cloudInstance.ipv4,
  };
}
