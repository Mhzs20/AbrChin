import { PrismaClient, OtpPurpose, UserRole } from "@prisma/client";

import { generateSessionToken, hashWithSecret } from "../lib/crypto.ts";

const mode = process.argv[2] ?? "session";
const mobile = process.argv[3] ?? "09128889999";
const prisma = new PrismaClient();
const secret = process.env.SESSION_SECRET ?? "dev-session-secret-change-me-32";

if (mode === "otp") {
  const code = process.argv[4] ?? "123456";
  await prisma.otpChallenge.deleteMany({ where: { mobile, purpose: OtpPurpose.LOGIN } });
  await prisma.otpChallenge.create({
    data: {
      mobile,
      purpose: OtpPurpose.LOGIN,
      codeHash: hashWithSecret(code, secret),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
  console.log(code);
} else {
  const role = (process.argv[4] ?? "ADMIN") as UserRole;
  const user = await prisma.user.upsert({
    where: { mobile },
    update: { role },
    create: { mobile, role, mobileVerifiedAt: new Date() },
  });
  const token = generateSessionToken();
  const tokenHash = hashWithSecret(token, secret);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId: user.id, tokenHash, expiresAt } });
  console.log(token);
}

await prisma.$disconnect();
