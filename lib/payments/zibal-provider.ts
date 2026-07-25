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
 * Zibal IPG REST adapter (official OpenAPI: https://api.zibal.ir/static/helpdocs/ipg.json).
 * Server: https://gateway.zibal.ir
 * - POST /v1/request  (amount in Rials)
 * - GET  /start/{trackId}
 * - POST /v1/verify
 * Callback query: success, trackId, orderId, status
 */
export type ZibalConfig = {
  merchant: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export class ZibalPaymentProvider implements PaymentProvider {
  readonly name = "zibal" as const;
  readonly prismaProvider = "ZIBAL" as const;
  private readonly config: ZibalConfig;

  constructor(config: ZibalConfig) {
    this.config = config;
  }

  validateConfiguration(): ConfigurationValidation {
    if (!this.config.merchant.trim()) {
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
    return `https://gateway.zibal.ir/start/${encodeURIComponent(authority)}`;
  }

  normalizeCallback(params: CallbackParams): NormalizedCallback {
    const trackId = params.trackId || params.TrackId || params.authority || params.Authority || null;
    const successRaw = params.success ?? params.Success ?? null;
    const status = params.status || params.Status || null;
    let successHint: boolean | null = null;
    if (successRaw === "1" || successRaw === "true") successHint = true;
    else if (successRaw === "0" || successRaw === "false") successHint = false;

    return {
      authority: trackId ? String(trackId) : null,
      statusHint: status ? String(status) : successHint === false ? "0" : successHint === true ? "1" : null,
      orderId: params.orderId || params.OrderId || null,
      successHint,
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertConfigured();
    if (input.amountRial <= 0n) {
      throw new PaymentError("invalid_amount", "Payment amount must be positive");
    }

    const payload = await this.postJson("/v1/request", {
      merchant: this.config.merchant,
      amount: Number(input.amountRial),
      callbackUrl: input.callbackUrl,
      description: input.description,
      orderId: input.metadata?.topUpId,
      mobile: input.metadata?.mobile,
    });

    if (!isRecord(payload)) {
      throw new PaymentError("invalid_response", "Payment provider returned unexpected payload");
    }

    const result = payload.result;
    const trackId = payload.trackId;
    if (result !== 100 || (typeof trackId !== "number" && typeof trackId !== "string")) {
      throw new PaymentError("provider_rejected", "Payment provider rejected create request");
    }

    const authority = String(trackId);
    return {
      authority,
      redirectUrl: this.buildRedirectUrl(authority),
      gatewayReference: authority,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    this.assertConfigured();

    if (input.statusHint === "0" || input.statusHint === "canceled" || input.statusHint === "CANCEL") {
      return { ok: false, code: "canceled", message: "Payment was canceled by user or gateway" };
    }

    const trackIdNumber = Number(input.authority);
    if (!Number.isFinite(trackIdNumber) || trackIdNumber <= 0) {
      return { ok: false, code: "invalid_authority", message: "Invalid track id" };
    }

    let payload: unknown;
    try {
      payload = await this.postJson("/v1/verify", {
        merchant: this.config.merchant,
        trackId: trackIdNumber,
      });
    } catch (error) {
      if (error instanceof PaymentError) {
        return { ok: false, code: error.code, message: error.message };
      }
      return { ok: false, code: "network", message: "Payment verify network failed" };
    }

    if (!isRecord(payload)) {
      return { ok: false, code: "invalid_response", message: "Payment verify payload unexpected" };
    }

    const result = payload.result;
    // Official verify result codes: 100 success, 201 already verified
    if (result !== 100 && result !== 201) {
      return { ok: false, code: "verify_failed", message: "Payment verify was not successful" };
    }

    const amountRaw = payload.amount;
    let amountRial = input.expectedAmountRial;
    if (typeof amountRaw === "number" || typeof amountRaw === "string") {
      try {
        amountRial = BigInt(amountRaw);
      } catch {
        return { ok: false, code: "invalid_amount", message: "Payment verify amount invalid" };
      }
    }

    if (amountRial !== input.expectedAmountRial) {
      return { ok: false, code: "amount_mismatch", message: "Payment amount mismatch" };
    }

    const refNumber = payload.refNumber;
    return {
      ok: true,
      authority: input.authority,
      gatewayReference: refNumber != null ? String(refNumber) : input.authority,
      amountRial,
    };
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetchImpl(`https://gateway.zibal.ir${path}`, {
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
