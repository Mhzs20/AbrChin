import type { Metadata } from "next";

import { ProfilePanel } from "@/components/account/profile-panel";
import { requireCustomerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "پروفایل | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountProfilePage() {
  const user = await requireCustomerPage();

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  return (
    <ProfilePanel
      user={{
        mobile: dbUser.mobile,
        displayName: dbUser.displayName,
        mobileVerifiedAt: dbUser.mobileVerifiedAt?.toISOString() ?? null,
        createdAt: dbUser.createdAt.toISOString(),
      }}
    />
  );
}
