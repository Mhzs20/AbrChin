import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfilePanel } from "@/components/account/profile-panel";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "پروفایل | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/profile");

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
