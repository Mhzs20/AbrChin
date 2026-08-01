import { getEnv } from "@/lib/env";
import { ConsoleSmsProvider } from "./console-provider.ts";
import { KavenegarSmsProvider, SmsDeliveryError } from "./kavenegar.ts";
import type { SmsProvider } from "./types.ts";

export type { SmsProvider, SendOtpInput, SendOperationalAlertInput } from "./types.ts";
export { SmsDeliveryError, maskMobile } from "./kavenegar.ts";

export function createSmsProvider(): SmsProvider {
  const env = getEnv();
  const provider = env.smsProvider;

  if (provider === "console" || !provider) {
    if (env.isProduction) {
      throw new SmsDeliveryError(
        "misconfigured",
        "SMS_PROVIDER=console is not allowed in production. Configure a real SMS provider.",
      );
    }
    return new ConsoleSmsProvider();
  }

  if (provider === "kavenegar") {
    return new KavenegarSmsProvider({
      apiKey: env.kavenegarApiKey,
      template: env.kavenegarTemplate,
      alertTemplate: env.kavenegarAlertTemplate,
      timeoutMs: env.kavenegarTimeoutMs,
    });
  }

  if (env.isProduction) {
    throw new SmsDeliveryError(
      "misconfigured",
      "Unknown SMS provider is not allowed in production.",
    );
  }

  throw new SmsDeliveryError(
    "misconfigured",
    `SMS provider "${provider}" is not configured. Use SMS_PROVIDER=console or SMS_PROVIDER=kavenegar.`,
  );
}
