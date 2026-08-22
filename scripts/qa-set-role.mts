import { readFileSync } from "node:fs";

import { PrismaClient, UserRole } from "@prisma/client";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim();
}

const mobile = process.argv[2];
const role = (process.argv[3] ?? "ADMIN") as UserRole;
if (!mobile) throw new Error("mobile required");

const prisma = new PrismaClient();
await prisma.user.updateMany({ where: { mobile }, data: { role } });
console.log(`updated ${mobile} -> ${role}`);
await prisma.$disconnect();
