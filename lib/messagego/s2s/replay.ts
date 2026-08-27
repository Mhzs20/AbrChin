import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { S2SError } from "@/lib/messagego/s2s/hmac";

export async function claimS2SReplay(input: {
  serviceId: string;
  keyId: string;
  nonce: string;
  expiresAt: Date;
}) {
  try {
    await prisma.messageGoS2SReplayNonce.create({
      data: {
        serviceId: input.serviceId,
        keyId: input.keyId,
        nonce: input.nonce,
        expiresAt: input.expiresAt,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new S2SError("replay", "s2s nonce replay");
    }
    throw error;
  }
}
