export class SmsDeliveryError extends Error {
  readonly code: string;

  constructor(code: string, message = "SMS delivery failed") {
    super(message);
    this.name = "SmsDeliveryError";
    this.code = code;
  }
}

export function maskMobile(mobile: string): string {
  if (mobile.length < 7) return "***";
  return `${mobile.slice(0, 4)}***${mobile.slice(-2)}`;
}

export type KavenegarConfig = {
  apiKey: string;
  template: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

type SendOtpInput = {
  mobile: string;
  code: string;
  purpose: string;
};

type KavenegarReturn = {
  status: number;
  message?: string;
};

type KavenegarResponse = {
  return: KavenegarReturn;
  entries?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseKavenegarResponse(payload: unknown): KavenegarResponse {
  if (!isRecord(payload) || !isRecord(payload.return)) {
    throw new SmsDeliveryError("invalid_response", "SMS provider returned an unexpected payload");
  }

  const status = payload.return.status;
  if (typeof status !== "number" || !Number.isFinite(status)) {
    throw new SmsDeliveryError("invalid_response", "SMS provider returned an unexpected status");
  }

  const message = payload.return.message;
  if (message !== undefined && typeof message !== "string") {
    throw new SmsDeliveryError("invalid_response", "SMS provider returned an unexpected message");
  }

  return {
    return: {
      status,
      message,
    },
    entries: payload.entries,
  };
}

function mapProviderStatus(status: number): SmsDeliveryError {
  if (status === 424) {
    return new SmsDeliveryError("template_invalid", "SMS template is missing or not approved");
  }
  if (status === 402 || status === 407) {
    return new SmsDeliveryError("insufficient_credit", "SMS provider credit is insufficient");
  }
  return new SmsDeliveryError("provider_rejected", "SMS provider rejected the request");
}

/**
 * Kavenegar VerifyLookup SMS provider.
 * Uses REST directly; never logs API key, full request URL, or OTP.
 */
export class KavenegarSmsProvider {
  readonly name = "kavenegar";
  private readonly config: KavenegarConfig;

  constructor(config: KavenegarConfig) {
    this.config = config;
    if (!config.apiKey) {
      throw new SmsDeliveryError("misconfigured", "Kavenegar API key is not configured");
    }
    if (!config.template) {
      throw new SmsDeliveryError("misconfigured", "Kavenegar template is not configured");
    }
  }

  async sendOtp(input: SendOtpInput): Promise<void> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // API key stays in path; never log this URL.
    const endpoint = `https://api.kavenegar.com/v1/${this.config.apiKey}/verify/lookup.json`;
    const body = new URLSearchParams({
      receptor: input.mobile,
      token: input.code,
      template: this.config.template,
      type: "sms",
    });

    try {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new SmsDeliveryError("timeout", "SMS provider request timed out");
        }
        throw new SmsDeliveryError("network", "SMS provider network request failed");
      }

      const rawText = await response.text();
      let payload: unknown;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        if (!response.ok) {
          throw new SmsDeliveryError("http_error", "SMS provider HTTP request failed");
        }
        throw new SmsDeliveryError("invalid_json", "SMS provider returned invalid JSON");
      }

      if (!response.ok) {
        throw new SmsDeliveryError("http_error", "SMS provider HTTP request failed");
      }

      const parsed = parseKavenegarResponse(payload);
      if (parsed.return.status !== 200) {
        throw mapProviderStatus(parsed.return.status);
      }
    } catch (error) {
      if (error instanceof SmsDeliveryError) {
        console.error(
          `[sms:kavenegar] delivery_failed code=${error.code} mobile=${maskMobile(input.mobile)}`,
        );
        throw error;
      }
      console.error(`[sms:kavenegar] delivery_failed code=unknown mobile=${maskMobile(input.mobile)}`);
      throw new SmsDeliveryError("unknown", "SMS delivery failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
