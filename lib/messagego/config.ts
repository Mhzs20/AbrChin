import { getEnv } from "@/lib/env";

function configuredValue(value: string) {
  return value.trim().length > 0;
}

/** Non-secret configuration probe. Does not open a network connection. */
export function isMessageGoConfigured() {
  const env = getEnv();
  return (
    configuredValue(env.messageGoBaseUrl) &&
    configuredValue(env.messageGoClientId) &&
    configuredValue(env.messageGoClientSecret) &&
    configuredValue(env.messageGoTenantId) &&
    configuredValue(env.messageGoWorkspaceId)
  );
}
