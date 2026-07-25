import { getEnv } from "@/lib/env";
import { ConsoleSmsProvider } from "./console-provider";
import type { SmsProvider } from "./types";

export type { SmsProvider, SendOtpInput } from "./types";

export function createSmsProvider(): SmsProvider {
  const env = getEnv();
  const provider = env.smsProvider;

  if (provider === "console" || !provider) {
    if (env.isProduction) {
      throw new Error(
        "SMS_PROVIDER=console is not allowed in production. Configure a real SMS provider.",
      );
    }
    return new ConsoleSmsProvider();
  }

  // Future real providers (Kavenegar, Ghasedak, etc.) should be wired here
  // after SMS_PROVIDER / SMS_API_KEY / SMS_SENDER are configured.
  throw new Error(
    `SMS provider "${provider}" is not configured yet. Use SMS_PROVIDER=console for development.`,
  );
}
