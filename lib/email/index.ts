import { getEnv } from "@/lib/env";

import { ConsoleEmailProvider } from "./console-provider.ts";
import { SmtpEmailProvider } from "./smtp-provider.ts";
import { EmailDeliveryError, type EmailProvider } from "./types.ts";

export type { EmailProvider, SendEmailInput } from "./types.ts";
export { EmailDeliveryError } from "./types.ts";
export { ConsoleEmailProvider } from "./console-provider.ts";

export function createEmailProvider(): EmailProvider {
  const env = getEnv();
  const provider = env.emailProvider;

  if (provider === "console" || !provider) {
    if (env.isProduction) {
      throw new EmailDeliveryError(
        "misconfigured",
        "EMAIL_PROVIDER=console is not allowed in production. Configure SMTP.",
      );
    }
    return new ConsoleEmailProvider();
  }

  if (provider === "smtp") {
    if (
      !env.smtpHost ||
      !env.smtpUser ||
      !env.smtpPassword ||
      !env.emailFrom
    ) {
      throw new EmailDeliveryError(
        "misconfigured",
        "SMTP email requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and EMAIL_FROM.",
      );
    }
    return new SmtpEmailProvider({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      user: env.smtpUser,
      password: env.smtpPassword,
      from: env.emailFrom,
      timeoutMs: env.smtpTimeoutMs,
    });
  }

  if (env.isProduction) {
    throw new EmailDeliveryError(
      "misconfigured",
      "Unknown EMAIL_PROVIDER is not allowed in production.",
    );
  }

  throw new EmailDeliveryError(
    "misconfigured",
    `EMAIL_PROVIDER="${provider}" is not configured. Use console or smtp.`,
  );
}
