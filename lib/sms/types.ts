export type SendOtpInput = {
  mobile: string;
  code: string;
  purpose: string;
};

export interface SmsProvider {
  readonly name: string;
  sendOtp(input: SendOtpInput): Promise<void>;
}
