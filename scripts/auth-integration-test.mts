import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PrismaClient, OtpPurpose } from "@prisma/client";

import { hashWithSecret, safeEqualHex } from "../lib/crypto.ts";
import {
  OTP_MAX_ATTEMPTS,
  canAttemptOtp,
} from "../lib/otp-rules.ts";
import { createThenDeliverOtpChallenge } from "../lib/otp-delivery.ts";
import { SmsDeliveryError } from "../lib/sms/kavenegar.ts";

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET || "test-session-secret-32chars!!";

const prisma = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function cleanup(mobile: string) {
  if (!prisma) return;
  await prisma.session.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });
  await prisma.otpChallenge.deleteMany({ where: { mobile } });
}

test("integration: create user, session, otp lifecycle, logout revoke", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set — skipping DB integration tests");
    return;
  }

  const mobile = "09120001122";
  await cleanup(mobile);

  t.after(async () => {
    await cleanup(mobile);
  });

  const code = "654321";
  const codeHash = hashWithSecret(code, sessionSecret);
  const challenge = await prisma.otpChallenge.create({
    data: {
      mobile,
      codeHash,
      purpose: OtpPurpose.LOGIN,
      expiresAt: new Date(Date.now() + 120_000),
    },
  });

  assert.equal(canAttemptOtp(challenge), null);
  assert.equal(safeEqualHex(codeHash, hashWithSecret(code, sessionSecret)), true);

  // Exhaust attempts simulation then reset with fresh challenge semantics
  let attempts = 0;
  while (attempts < OTP_MAX_ATTEMPTS) {
    attempts += 1;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts },
    });
  }
  const exhausted = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challenge.id } });
  assert.equal(canAttemptOtp(exhausted), "max_attempts");

  const fresh = await prisma.otpChallenge.create({
    data: {
      mobile,
      codeHash: hashWithSecret("111222", sessionSecret),
      purpose: OtpPurpose.LOGIN,
      expiresAt: new Date(Date.now() + 120_000),
    },
  });

  await prisma.otpChallenge.update({
    where: { id: fresh.id },
    data: { consumedAt: new Date() },
  });
  const consumed = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(canAttemptOtp(consumed), "consumed");

  const expired = await prisma.otpChallenge.create({
    data: {
      mobile,
      codeHash: hashWithSecret("333444", sessionSecret),
      purpose: OtpPurpose.LOGIN,
      expiresAt: new Date(Date.now() - 1_000),
    },
  });
  assert.equal(canAttemptOtp(expired), "expired");

  const firstUser = await prisma.user.upsert({
    where: { mobile },
    create: { mobile, mobileVerifiedAt: new Date() },
    update: { mobileVerifiedAt: new Date() },
  });
  const secondUser = await prisma.user.upsert({
    where: { mobile },
    create: { mobile, mobileVerifiedAt: new Date() },
    update: { mobileVerifiedAt: new Date() },
  });
  assert.equal(firstUser.id, secondUser.id);

  const tokenHash = hashWithSecret("raw-session-token", sessionSecret);
  const session = await prisma.session.create({
    data: {
      userId: firstUser.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ipAddress: "127.0.0.1",
      userAgent: "auth-integration-test",
    },
  });

  const valid = await prisma.session.findUnique({ where: { id: session.id } });
  assert.ok(valid);
  assert.equal(valid?.revokedAt, null);

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  const revoked = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
  assert.ok(revoked.revokedAt);
});

test("integration: SMS failure deletes challenge so it is not consumable", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set — skipping DB integration tests");
    return;
  }

  const mobile = "09120009988";
  await cleanup(mobile);

  t.after(async () => {
    await cleanup(mobile);
  });

  await assert.rejects(() =>
    createThenDeliverOtpChallenge(
      () =>
        prisma.otpChallenge.create({
          data: {
            mobile,
            codeHash: hashWithSecret("111222", sessionSecret),
            purpose: OtpPurpose.LOGIN,
            expiresAt: new Date(Date.now() + 120_000),
          },
        }),
      async () => {
        throw new SmsDeliveryError("network", "SMS provider network request failed");
      },
      async (challenge) => {
        await prisma.otpChallenge.delete({ where: { id: challenge.id } });
      },
    ),
  );

  const leftover = await prisma.otpChallenge.findFirst({
    where: { mobile, consumedAt: null },
  });
  assert.equal(leftover, null);
});
