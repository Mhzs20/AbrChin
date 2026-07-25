import { GatewayConfigError, PaymentError } from "./errors.ts";
import type {
  CallbackParams,
  ConfigurationValidation,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedCallback,
  PaymentProvider,
  VerifyPaymentInput,
  VerifyPaymentResult,
} from "./types.ts";

/**
 * Local mock gateway for Development/Test only.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly prismaProvider = "MOCK" as const;
  private readonly callbackBaseUrl: string;

  constructor(callbackBaseUrl: string) {
    this.callbackBaseUrl = callbackBaseUrl;
  }

  validateConfiguration(): ConfigurationValidation {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        code: "invalid_environment",
        message: "اطلاعات اتصال روی سرور تنظیم نشده است",
      };
    }
    if (!this.callbackBaseUrl) {
      return {
        ok: false,
        code: "missing_credentials",
        message: "اطلاعات اتصال روی سرور تنظیم نشده است",
      };
    }
    return { ok: true };
  }

  private assertConfigured() {
    const validation = this.validateConfiguration();
    if (!validation.ok) {
      throw new GatewayConfigError(validation.message);
    }
  }

  buildRedirectUrl(authority: string): string {
    this.assertConfigured();
    const redirect = new URL("/account/wallet/mock-gateway", this.callbackBaseUrl);
    redirect.searchParams.set("authority", authority);
    return redirect.toString();
  }

  normalizeCallback(params: CallbackParams): NormalizedCallback {
    const authority =
      params.Authority || params.authority || params.trackId || params.TrackId || null;
    const statusHint = params.Status || params.status || null;
    return {
      authority,
      statusHint,
      orderId: params.orderId || params.topUpId || null,
      successHint:
        statusHint === "OK" || statusHint === "ok"
          ? true
          : statusHint === "NOK" || statusHint === "CANCEL" || statusHint === "FAILED"
            ? false
            : null,
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertConfigured();
    if (input.amountRial <= 0n) {
      throw new PaymentError("invalid_amount", "Payment amount must be positive");
    }

    const authority = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const redirect = new URL("/account/wallet/mock-gateway", this.callbackBaseUrl);
    redirect.searchParams.set("authority", authority);
    redirect.searchParams.set("amount", input.amountRial.toString());
    redirect.searchParams.set("callback", input.callbackUrl);

    return {
      authority,
      redirectUrl: redirect.toString(),
      gatewayReference: authority,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    this.assertConfigured();
    if (!input.authority.startsWith("mock_")) {
      return { ok: false, code: "invalid_authority", message: "Unknown mock authority" };
    }

    if (input.statusHint === "NOK" || input.statusHint === "CANCEL" || input.statusHint === "FAILED") {
      return {
        ok: false,
        code: input.statusHint === "CANCEL" ? "canceled" : "failed",
        message: "Mock payment was not successful",
      };
    }

    return {
      ok: true,
      authority: input.authority,
      gatewayReference: input.authority,
      amountRial: input.expectedAmountRial,
    };
  }
}
