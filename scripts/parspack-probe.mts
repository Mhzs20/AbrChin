import { getEnv } from "../lib/env.ts";
import { ParsPackProvider } from "../lib/infrastructure/parspack/client.ts";

async function main() {
  const env = getEnv();
  if (!env.parspackApiToken) {
    throw new Error("PARSPACK_API_TOKEN is not configured");
  }

  const provider = new ParsPackProvider({
    managementBaseUrl: env.parspackApiBaseUrl,
    publicBaseUrl: env.parspackPublicApiBaseUrl,
    token: env.parspackApiToken,
    timeoutMs: env.parspackTimeoutMs,
  });

  const health = await provider.checkConnection();
  if (!health.ok) {
    throw new Error("ParsPack connection check failed");
  }

  const catalog = await provider.syncCatalog();
  const availableSizes = catalog.sizes.filter((size) => size.available !== false);
  const pricedSizes = availableSizes.filter(
    (size) =>
      (size.priceHourly != null && Number(size.priceHourly) > 0) ||
      (size.priceMonthly != null && Number(size.priceMonthly) > 0),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        resources: {
          regions: catalog.regions.length,
          sizes: catalog.sizes.length,
          availableSizes: availableSizes.length,
          pricedSizes: pricedSizes.length,
          images: catalog.images.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "ParsPack probe failed");
  process.exitCode = 1;
});
