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
import { isRecord } from "./types.ts";

/**
 * ZarinPal REST v4 adapter (official docs: https://www.zarinpal.com/docs/paymentGateway/).
 * Production:
 * - POST https://payment.zarinpal.com/pg/v4/payment/request.json
 * - POST https://payment.zarinpal.com/pg/v4/payment/verify.json
 * - StartPay https://www.zarinpal.com/pg/StartPay/{authority}
 * Sandbox:
 * - https://sandbox.zarinpal.com/pg/v4/payment/{request|verify}.json
 * - https://sandbox.zarinpal.com/pg/StartPay/{authority}
 * Amount unit: IRR (Rials). Callback query: Authority, Status (OK|NOK).
 * Verify codes: 100 success, 101 already verified.
 */
export type ZarinpalConfig = {
  merchantId: string;
  sandbox: boolean;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class ZarinpalPaymentProvider implements PaymentProvider {
  readonly name = "zarinpal" as const;
  readonly prismaProvider = "ZARINPAL" as const;
  private readonly config: ZarinpalConfig;

  constructor(config: ZarinpalConfig) {
    this.config = config;
  }

  validateConfiguration(): ConfigurationValidation {
    if (!this.config.merchantId.trim()) {
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

  private baseUrl() {
    return this.config.sandbox
      ? "https://sandbox.zarinpal.com/pg/v4/payment"
      : "https://payment.zarinpal.com/pg/v4/payment";
  }

  buildRedirectUrl(authority: string): string {
    return this.config.sandbox
      ? `https://sandbox.zarinpal.com/pg/StartPay/${encodeURIComponent(authority)}`
      : `https://www.zarinpal.com/pg/StartPay/${encodeURIComponent(authority)}`;
  }

  normalizeCallback(params: CallbackParams): NormalizedCallback {
    const authority = params.Authority || params.authority || null;
    const statusHint = params.Status || params.status || null;
    return {
      authority,
      statusHint,
      orderId: params.orderId || params.topUpId || null,
      successHint:
        statusHint === "OK" || statusHint === "ok"
          ? true
          : statusHint === "NOK" || statusHint === "nok"
            ? false
            : null,
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertConfigured();
    if (input.amountRial <= 0n) {
      throw new PaymentError("invalid_amount", "Payment amount must be positive");
    }

    const payload = await this.postJson("/request.json", {
      merchant_id: this.config.merchantId,
      amount: Number(input.amountRial),
      callback_url: input.callbackUrl,
      description: input.description,
      metadata: input.metadata,
    });

    if (!isRecord(payload) || !isRecord(payload.data)) {
      throw new PaymentError("invalid_response", "Payment provider returned unexpected payload");
    }

    const data = payload.data as { code?: number; authority?: string };
    if (!data || data.code !== 100 || typeof data.authority !== "string" || !data.authority) {
      throw new PaymentError("provider_rejected", "Payment provider rejected create request");
    }

    return {
      authority: data.authority,
      redirectUrl: this.buildRedirectUrl(data.authority),
      gatewayReference: data.authority,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    this.assertConfigured();

    if (input.statusHint && input.statusHint !== "OK" && input.statusHint !== "ok") {
      return { ok: false, code: "canceled", message: "Payment was canceled by user or gateway" };
    }

    let payload: unknown;
    try {
      payload = await this.postJson("/verify.json", {
        merchant_id: this.config.merchantId,
        amount: Number(input.expectedAmountRial),
        authority: input.authority,
      });
    } catch (error) {
      if (error instanceof PaymentError) {
        return { ok: false, code: error.code, message: error.message };
      }
      return { ok: false, code: "network", message: "Payment verify network failed" };
    }

    if (!isRecord(payload) || !isRecord(payload.data)) {
      return { ok: false, code: "invalid_response", message: "Payment verify payload unexpected" };
    }

    const data = payload.data as { code?: number; ref_id?: number | string };
    if (!data || (data.code !== 100 && data.code !== 101)) {
      return { ok: false, code: "verify_failed", message: "Payment verify was not successful" };
    }

    return {
      ok: true,
      authority: input.authority,
      gatewayReference: String(data.ref_id ?? input.authority),
      amountRial: input.expectedAmountRial,
    };
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetchImpl(`${this.baseUrl()}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new PaymentError("timeout", "Payment provider request timed out");
        }
        throw new PaymentError("network", "Payment provider network request failed");
      }

      const text = await response.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new PaymentError("invalid_json", "Payment provider returned invalid JSON");
      }

      if (!response.ok) {
        throw new PaymentError("http_error", "Payment provider HTTP request failed");
      }

      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}
