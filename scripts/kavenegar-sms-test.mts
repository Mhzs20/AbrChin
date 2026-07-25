import assert from "node:assert/strict";
import test from "node:test";

import { createThenDeliverOtpChallenge } from "../lib/otp-delivery.ts";
import { KavenegarSmsProvider, SmsDeliveryError, maskMobile } from "../lib/sms/kavenegar.ts";
import { ConsoleSmsProvider } from "../lib/sms/console-provider.ts";

const API_KEY = "test-api-key-should-never-leak";
const OTP = "424242";
const MOBILE = "09123456789";
const TEMPLATE = "abrchinlogin";

function jsonResponse(status: number, body: unknown, httpOk = true): Response {
  return new Response(JSON.stringify(body), {
    status: httpOk ? status : status,
    headers: { "Content-Type": "application/json" },
    statusText: httpOk ? "OK" : "Error",
  });
}

test("kavenegar VerifyLookup succeeds on HTTP ok and return.status 200", async () => {
  let sawRequest = false;

  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async (input, init) => {
      sawRequest = true;
      const url = String(input);
      assert.equal(url.includes(`/v1/${API_KEY}/verify/lookup.json`), true);
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers && (init.headers as Record<string, string>)["Content-Type"], "application/x-www-form-urlencoded");

      const body = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(body.get("receptor"), MOBILE);
      assert.equal(body.get("token"), OTP);
      assert.equal(body.get("template"), TEMPLATE);
      assert.equal(body.get("type"), "sms");

      return jsonResponse(200, {
        return: { status: 200, message: "OK" },
        entries: { receptor: MOBILE },
      });
    },
  });

  await provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" });
  assert.equal(sawRequest, true);
});

test("kavenegar rejects non-200 return.status", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async () =>
      jsonResponse(200, {
        return: { status: 424, message: "template missing" },
      }),
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(error.code, "template_invalid");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes(OTP), false);
      return true;
    },
  );
});

test("kavenegar rejects HTTP errors", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async () => new Response("nope", { status: 500, statusText: "Server Error" }),
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(["http_error", "invalid_json"].includes(error.code), true);
      assert.equal(String(error).includes(API_KEY), false);
      assert.equal(String(error).includes(OTP), false);
      return true;
    },
  );
});

test("kavenegar rejects network errors", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(error.code, "network");
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
});

test("kavenegar rejects timeouts", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 20,
    fetchImpl: async (_input, init) => {
      await new Promise<void>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return jsonResponse(200, { return: { status: 200 } });
    },
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(error.code, "timeout");
      return true;
    },
  );
});

test("kavenegar rejects invalid JSON", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async () => new Response("{not-json", { status: 200 }),
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(error.code, "invalid_json");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes(OTP), false);
      return true;
    },
  );
});

test("kavenegar rejects insufficient credit status", async () => {
  const provider = new KavenegarSmsProvider({
    apiKey: API_KEY,
    template: TEMPLATE,
    timeoutMs: 8000,
    fetchImpl: async () =>
      jsonResponse(200, {
        return: { status: 402, message: "credit" },
      }),
  });

  await assert.rejects(
    () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
    (error: unknown) => {
      assert.ok(error instanceof SmsDeliveryError);
      assert.equal(error.code, "insufficient_credit");
      return true;
    },
  );
});

test("masked mobile never includes full number", () => {
  assert.equal(maskMobile(MOBILE), "0912***89");
  assert.equal(maskMobile(MOBILE).includes("345678"), false);
});

test("SMS delivery failure removes challenge so it is not consumable", async () => {
  const store = new Map<string, { id: string; usable: boolean }>();

  await assert.rejects(() =>
    createThenDeliverOtpChallenge(
      async () => {
        const challenge = { id: "challenge-1", usable: true };
        store.set(challenge.id, challenge);
        return challenge;
      },
      async () => {
        throw new SmsDeliveryError("network", "SMS provider network request failed");
      },
      async (challenge) => {
        store.delete(challenge.id);
      },
    ),
  );

  assert.equal(store.size, 0);
});

test("console SMS fails closed in production", async () => {
  const provider = new ConsoleSmsProvider();
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => provider.sendOtp({ mobile: MOBILE, code: OTP, purpose: "LOGIN" }),
      /must not send OTP in production/,
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
});
