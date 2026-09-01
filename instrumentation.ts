import { validateProviderEnvironment } from "@/lib/env";
import { loadFileSecrets } from "@/lib/secrets/file-secrets.ts";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    loadFileSecrets();
    validateProviderEnvironment();
  }
}
