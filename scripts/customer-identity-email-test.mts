import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

import { verifyLoginOtp } from "../lib/auth-service.ts";
import { ConsoleEmailProvider } from "../lib/email/console-provider.ts";
import {
  requestEmailVerification,
  verifyEmailVerificationCode,
} from "../lib/identity/email-verification.ts";
import { completeCustomerRegistration } from "../lib/identity/registration.ts";
import { hashWithSecret } from "../lib/crypto.ts";
import { assertServerSecrets } from "../lib/env.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;

async function cleanupMobile(mobile: string) {
  if (!prisma) return;
  const user = await prisma.user.findUnique({ where: { mobile } });
  if (!user) {
    await prisma.otpChallenge.deleteMany({ where: { mobile } });
    return;
  }
  await prisma.emailVerificationChallenge.deleteMany({
    where: { userId: user.id },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.walletLedgerEntry.deleteMany({
    where: { wallet: { userId: user.id } },
  });
  await prisma.wallet.deleteMany({ where: { userId: user.id } });
  await prisma.otpChallenge.deleteMany({ where: { mobile } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function seedLoginOtp(mobile: string, code = "123456") {
  if (!prisma) throw new Error("no db");
  const env = assertServerSecrets();
  await prisma.otpChallenge.deleteMany({ where: { mobile, purpose: "LOGIN" } });
  await prisma.otpChallenge.create({
    data: {
      mobile,
      codeHash: hashWithSecret(code, env.sessionSecret),
      purpose: "LOGIN",
      expiresAt: new Date(Date.now() + 120_000),
    },
  });
}

test("registration and email verification source contracts exist", async () => {
  const registration = await readFile(
    "lib/identity/registration.ts",
    "utf8",
  );
  assert.match(registration, /completeCustomerRegistration/);
  assert.match(registration, /registrationCompletedAt/);
  assert.match(registration, /email_taken/);

  const emailSvc = await readFile(
    "lib/identity/email-verification.ts",
    "utf8",
  );
  assert.match(emailSvc, /emailVerificationChallenge/);
  assert.match(emailSvc, /hashWithSecret/);
  assert.match(emailSvc, /createEmailProvider/);
  assert.doesNotMatch(emailSvc, /console\.log\([^\)]*code/);

  const guards = await readFile("lib/auth/guards.ts", "utf8");
  assert.match(guards, /RegistrationIncompleteError/);
  assert.match(guards, /requireRegistrationPage/);
  assert.match(guards, /registrationComplete/);

  const migration = await readFile(
    "prisma/migrations/20260807150000_customer_identity_email_verification/migration.sql",
    "utf8",
  );
  assert.match(migration, /registrationCompletedAt/);
  assert.match(migration, /EmailVerificationChallenge/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.match(
    migration,
    /SET "registrationCompletedAt" = COALESCE/,
  );
});

test("new mobile OTP requires registration; existing user does not", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const newMobile = "09123330101";
  const existingMobile = "09123330102";
  await cleanupMobile(newMobile);
  await cleanupMobile(existingMobile);

  await prisma.user.create({
    data: {
      mobile: existingMobile,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
      registrationCompletedAt: new Date(),
      firstName: "قدیمی",
      lastName: "کاربر",
      email: "legacy-user@example.com",
      displayName: "قدیمی کاربر",
    },
  });

  await seedLoginOtp(newMobile);
  const created = await verifyLoginOtp(newMobile, "123456");
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.user.registrationComplete, false);
  assert.equal(created.user.role, "CUSTOMER");

  await seedLoginOtp(existingMobile);
  const existing = await verifyLoginOtp(existingMobile, "123456");
  assert.equal(existing.ok, true);
  if (!existing.ok) return;
  assert.equal(existing.user.registrationComplete, true);

  await cleanupMobile(newMobile);
  await cleanupMobile(existingMobile);
});

test("complete registration validates fields, normalizes email, rejects duplicates", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobileA = "09123330103";
  const mobileB = "09123330104";
  await cleanupMobile(mobileA);
  await cleanupMobile(mobileB);

  const userA = await prisma.user.create({
    data: {
      mobile: mobileA,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      mobile: mobileB,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
      registrationCompletedAt: new Date(),
      email: "taken@example.com",
      firstName: "دیگر",
      lastName: "کاربر",
      displayName: "دیگر کاربر",
    },
  });

  await assert.rejects(
    () =>
      completeCustomerRegistration({
        userId: userA.id,
        firstName: "",
        lastName: "محمدی",
        email: "a@example.com",
      }),
    /نام/,
  );
  await assert.rejects(
    () =>
      completeCustomerRegistration({
        userId: userA.id,
        firstName: "علی",
        lastName: "",
        email: "a@example.com",
      }),
    /نام خانوادگی/,
  );
  await assert.rejects(
    () =>
      completeCustomerRegistration({
        userId: userA.id,
        firstName: "علی",
        lastName: "محمدی",
        email: "bad",
      }),
    /ایمیل/,
  );
  await assert.rejects(
    () =>
      completeCustomerRegistration({
        userId: userA.id,
        firstName: "علی",
        lastName: "محمدی",
        email: "taken@example.com",
      }),
    /ایمیل/,
  );

  const done = await completeCustomerRegistration({
    userId: userA.id,
    firstName: " علی ",
    lastName: " محمدی ",
    email: "  New.User@Example.COM ",
  });
  assert.equal(done.registrationComplete, true);
  assert.equal(done.email, "new.user@example.com");
  assert.equal(done.firstName, "علی");
  assert.equal(done.lastName, "محمدی");
  assert.equal(done.displayName, "علی محمدی");
  assert.equal(done.emailVerifiedAt, null);

  // Idempotent same payload
  const again = await completeCustomerRegistration({
    userId: userA.id,
    firstName: "علی",
    lastName: "محمدی",
    email: "new.user@example.com",
  });
  assert.equal(again.id, done.id);

  await cleanupMobile(mobileA);
  await cleanupMobile(mobileB);
});

test("email verification request/verify lifecycle with fake provider", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09123330105";
  await cleanupMobile(mobile);
  const env = assertServerSecrets();
  const user = await prisma.user.create({
    data: {
      mobile,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
      registrationCompletedAt: new Date(),
      firstName: "سارا",
      lastName: "رضایی",
      email: "sara@example.com",
      displayName: "سارا رضایی",
    },
  });

  const fake = new ConsoleEmailProvider();
  const requested = await requestEmailVerification({
    userId: user.id,
    emailProvider: fake,
  });
  assert.equal(requested.ok, true);
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0]!.text, /\d{6}/);
  // Code must not be stored plaintext
  const challenge = await prisma.emailVerificationChallenge.findFirstOrThrow({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  assert.doesNotMatch(challenge.codeHash, /^\d{6}$/);
  const codeMatch = fake.sent[0]!.text.match(/(\d{6})/);
  assert.ok(codeMatch);
  const code = codeMatch![1]!;
  assert.equal(
    challenge.codeHash,
    hashWithSecret(code, env.sessionSecret),
  );

  const wrong = await verifyEmailVerificationCode({
    userId: user.id,
    code: "000000",
  });
  assert.equal(wrong.ok, false);

  const ok = await verifyEmailVerificationCode({ userId: user.id, code });
  assert.equal(ok.ok, true);
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(updated.emailVerifiedAt);

  const replay = await verifyEmailVerificationCode({ userId: user.id, code });
  // Already verified → ok true without inconsistent state
  assert.equal(replay.ok, true);

  // Changing email resets verification
  await prisma.user.update({
    where: { id: user.id },
    data: { email: "sara2@example.com", emailVerifiedAt: null },
  });
  await prisma.emailVerificationChallenge.deleteMany({
    where: { userId: user.id },
  });

  // Expired challenge rejected
  const expiredCode = "654321";
  await prisma.emailVerificationChallenge.create({
    data: {
      userId: user.id,
      email: "sara2@example.com",
      codeHash: hashWithSecret(expiredCode, env.sessionSecret),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const expired = await verifyEmailVerificationCode({
    userId: user.id,
    code: expiredCode,
  });
  assert.equal(expired.ok, false);

  // Provider failure must not claim success
  const failing = {
    async send() {
      const { EmailDeliveryError } = await import("../lib/email/types.ts");
      throw new EmailDeliveryError("delivery_failed", "boom");
    },
  };
  await prisma.user.update({
    where: { id: user.id },
    data: { email: "sara3@example.com", emailVerifiedAt: null },
  });
  const failed = await requestEmailVerification({
    userId: user.id,
    emailProvider: failing,
  });
  assert.equal(failed.ok, false);
  const leftover = await prisma.emailVerificationChallenge.count({
    where: { userId: user.id, consumedAt: null },
  });
  assert.equal(leftover, 0);

  await cleanupMobile(mobile);
});

test("historical user row remains login-compatible after identity columns", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const mobile = "09123330106";
  await cleanupMobile(mobile);
  // Simulate production-style row that was backfilled by migration.
  await prisma.user.create({
    data: {
      mobile,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      registrationCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
      displayName: "کاربر قدیمی",
      firstName: null,
      lastName: null,
      email: null,
      emailVerifiedAt: null,
    },
  });
  await seedLoginOtp(mobile);
  const result = await verifyLoginOtp(mobile, "123456");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.user.registrationComplete, true);
  assert.equal(result.user.displayName, "کاربر قدیمی");
  await cleanupMobile(mobile);
});

test("admin allowlist still promotes on login", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const adminMobile = process.env.ADMIN_MOBILES?.split(",")[0]?.trim();
  if (!adminMobile) {
    t.skip("ADMIN_MOBILES not set");
    return;
  }
  // Do not delete admin if shared — just verify OTP path role.
  await prisma.otpChallenge.deleteMany({
    where: { mobile: adminMobile, purpose: "LOGIN" },
  });
  await seedLoginOtp(adminMobile);
  const result = await verifyLoginOtp(adminMobile, "123456");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.user.role, "ADMIN");
  assert.equal(result.user.registrationComplete, true);
});
