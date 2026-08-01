export type SendOtpInput = {
  mobile: string;
  code: string;
  purpose: string;
};

export type SendOperationalAlertInput = {
  mobile: string;
  safeCode: string;
  provider: string;
  severity: "WARNING" | "CRITICAL";
};

export interface SmsProvider {
  readonly name: string;
  sendOtp(input: SendOtpInput): Promise<void>;
  sendOperationalAlert?(input: SendOperationalAlertInput): Promise<void>;
}
