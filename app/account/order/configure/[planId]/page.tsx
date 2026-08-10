import { redirect } from "next/navigation";

/** Compatibility redirect: configuration is public so Quote precedes Login. */
export default async function LegacyConfigureServerOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const [{ planId }, { product }] = await Promise.all([params, searchParams]);
  const query = product === "ready-servers" ? "?product=ready-servers" : "";
  redirect(
    `/cloud-servers/configure/${encodeURIComponent(planId)}${query}`,
  );
}
