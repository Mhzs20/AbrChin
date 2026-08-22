import { readFileSync } from "node:fs";

import { OtpPurpose, PrismaClient } from "@prisma/client";

import { hashWithSecret } from "../lib/crypto.ts";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim();
}

const prisma = new PrismaClient();
const mobile = process.argv[2] ?? "09128889999";
const code = "123456";
await prisma.otpChallenge.deleteMany({ where: { mobile, purpose: OtpPurpose.LOGIN } });
await prisma.otpChallenge.create({
  data: {
    mobile,
    purpose: OtpPurpose.LOGIN,
    codeHash: hashWithSecret(code, process.env.SESSION_SECRET!),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    attempts: 0,
  },
});
console.log("ready");
await prisma.$disconnect();
