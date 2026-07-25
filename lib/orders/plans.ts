export const SERVICE_PLANS = {
  STARTER: {
    code: "STARTER",
    title: "شروع ابرچین",
    description: "شروع ساده برای یک پروژه کوچک",
    amountToman: 150_000,
  },
  GROWTH: {
    code: "GROWTH",
    title: "رشد ابرچین",
    description: "ظرفیت بیشتر برای رشد روزانه",
    amountToman: 450_000,
  },
  MANAGED: {
    code: "MANAGED",
    title: "مدیریت‌شده ابرچین",
    description: "همراهی مدیریت‌شده برای تیم‌ها",
    amountToman: 1_200_000,
  },
} as const;

export type ServicePlanCode = keyof typeof SERVICE_PLANS;

export function getServicePlan(code: string) {
  if (code in SERVICE_PLANS) {
    return SERVICE_PLANS[code as ServicePlanCode];
  }
  return null;
}
