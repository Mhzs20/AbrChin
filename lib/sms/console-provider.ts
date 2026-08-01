import type { SendOperationalAlertInput, SendOtpInput, SmsProvider } from "./types";

/**
 * Development-only provider. Prints OTP to the server console.
 * Fail-closed in production: never logs or "sends" an OTP.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";

  async sendOtp(input: SendOtpInput): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ConsoleSmsProvider must not send OTP in production");
    }

    console.info(
      `[sms:console] purpose=${input.purpose} mobile=${input.mobile} otp=${input.code}`,
    );
  }

  async sendOperationalAlert(input: SendOperationalAlertInput): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ConsoleSmsProvider must not send alerts in production");
    }
    console.info(
      `[sms:console] operational_alert mobile=${input.mobile} provider=${input.provider} code=${input.safeCode} severity=${input.severity}`,
    );
  }
}
