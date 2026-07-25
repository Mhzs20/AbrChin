export class PaymentError extends Error {
  readonly code: string;

  constructor(code: string, message = "Payment provider error") {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

export class GatewayConfigError extends PaymentError {
  constructor(message = "اطلاعات اتصال روی سرور تنظیم نشده است") {
    super("configuration", message);
    this.name = "GatewayConfigError";
  }
}
