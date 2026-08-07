export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code:
      | "misconfigured"
      | "delivery_failed"
      | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}
