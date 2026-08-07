export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export class EmailDeliveryError extends Error {
  readonly code: "misconfigured" | "delivery_failed" | "timeout";

  constructor(
    code: "misconfigured" | "delivery_failed" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}
