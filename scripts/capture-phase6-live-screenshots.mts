/**
 * Seed + capture Phase 6 identity / money screenshots from live app.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

import { createUserSession } from "../lib/session-store.ts";
import { requestEmailVerification } from "../lib/identity/email-verification.ts";
import { ConsoleEmailProvider } from "../lib/email/console-provider.ts";
import { tomanToRial } from "../lib/money.ts";

const BASE = "http://localhost:3010";
const OUT = "/opt/cursor/artifacts/screenshots";
const prisma = new PrismaClient();

async function waitForWs(port: number) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl: string };
        return body.webSocketDebuggerUrl;
      }
    } catch {
      // retry
    }
    await delay(200);
  }
  throw new Error("Chrome DevTools not ready");
}

async function ensureFixtures() {
  // Completed customer with wallet for money screenshots
  const moneyUser = await prisma.user.upsert({
    where: { mobile: "09123330901" },
    update: {
      firstName: "نمایش",
      lastName: "پول",
      email: "money.demo@example.com",
      emailVerifiedAt: null,
      registrationCompletedAt: new Date(),
      displayName: "نمایش پول",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
    create: {
      mobile: "09123330901",
      firstName: "نمایش",
      lastName: "پول",
      email: "money.demo@example.com",
      registrationCompletedAt: new Date(),
      displayName: "نمایش پول",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
  });
  await prisma.wallet.upsert({
    where: { userId: moneyUser.id },
    update: { availableBalance: tomanToRial(1_250_000) },
    create: {
      userId: moneyUser.id,
      availableBalance: tomanToRial(1_250_000),
      status: "ACTIVE",
    },
  });

  // Incomplete registration user
  const incomplete = await prisma.user.upsert({
    where: { mobile: "09123330902" },
    update: {
      firstName: null,
      lastName: null,
      email: null,
      emailVerifiedAt: null,
      registrationCompletedAt: null,
      displayName: null,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
    create: {
      mobile: "09123330902",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
  });
  await prisma.wallet.upsert({
    where: { userId: incomplete.id },
    update: { availableBalance: 0n },
    create: { userId: incomplete.id, availableBalance: 0n, status: "ACTIVE" },
  });

  // Profile unverified / verified users
  const profileUser = await prisma.user.upsert({
    where: { mobile: "09123330903" },
    update: {
      firstName: "سارا",
      lastName: "احمدی",
      email: "sara.profile@example.com",
      emailVerifiedAt: null,
      registrationCompletedAt: new Date(),
      displayName: "سارا احمدی",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
    create: {
      mobile: "09123330903",
      firstName: "سارا",
      lastName: "احمدی",
      email: "sara.profile@example.com",
      registrationCompletedAt: new Date(),
      displayName: "سارا احمدی",
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      mobileVerifiedAt: new Date(),
    },
  });
  await prisma.wallet.upsert({
    where: { userId: profileUser.id },
    update: { availableBalance: tomanToRial(500_000) },
    create: {
      userId: profileUser.id,
      availableBalance: tomanToRial(500_000),
      status: "ACTIVE",
    },
  });

  const moneySession = await createUserSession(moneyUser.id);
  const incompleteSession = await createUserSession(incomplete.id);
  const profileSession = await createUserSession(profileUser.id);

  // Seed an active quote for checkout money screenshot if possible
  let checkoutPath = "/account/wallet";
  const quote = await prisma.recommendationQuote.findFirst({
    where: {
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      session: { userId: moneyUser.id },
    },
    select: { id: true },
  });
  if (quote) checkoutPath = `/account/order/quote/${quote.id}`;

  return {
    moneyCookie: moneySession.token,
    incompleteCookie: incompleteSession.token,
    profileCookie: profileSession.token,
    profileUserId: profileUser.id,
    checkoutPath,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fixtures = await ensureFixtures();
  const port = 9340;
  const userData = `/tmp/chrome-phase6-${Date.now()}`;
  await mkdir(userData, { recursive: true });

  const chrome = spawn(
    "google-chrome",
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr: string[] = [];
  chrome.stderr.on("data", (d) => stderr.push(String(d)));

  try {
    const wsUrl = await waitForWs(port);
    const browserWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      browserWs.addEventListener("open", () => resolve());
      browserWs.addEventListener("error", () => reject(new Error("ws")));
    });

    let nextId = 1;
    const pending = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    browserWs.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "cdp"));
      else p.resolve(msg.result);
    });

    function send(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        browserWs.send(
          JSON.stringify(
            sessionId
              ? { id, method, params, sessionId }
              : { id, method, params },
          ),
        );
      });
    }

    const { targetId } = (await send("Target.createTarget", {
      url: "about:blank",
    })) as { targetId: string };
    const { sessionId } = (await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };
    const s = (method: string, params?: Record<string, unknown>) =>
      send(method, params, sessionId);

    await s("Page.enable");
    await s("Network.enable");

    async function setCookie(token: string) {
      await s("Network.setCookie", {
        name: "abrchin_session",
        value: token,
        url: BASE,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      });
    }

    async function shot(
      name: string,
      path: string,
      token: string,
      opts?: { width?: number; height?: number; waitMs?: number; click?: string[] },
    ) {
      await setCookie(token);
      const width = opts?.width ?? 1280;
      const height = opts?.height ?? 900;
      await s("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 500,
      });
      await s("Page.navigate", { url: `${BASE}${path}` });
      await delay(opts?.waitMs ?? 2200);
      if (opts?.click?.length) {
        await s("Runtime.evaluate", {
          expression: `(() => {
            const needles = ${JSON.stringify(opts.click)};
            const nodes = Array.from(document.querySelectorAll('button,a,[role=button]'));
            for (const n of needles) {
              const el = nodes.find(x => (x.textContent||'').includes(n));
              if (el) { el.click(); return n; }
            }
            return null;
          })()`,
          returnByValue: true,
        });
        await delay(1500);
      }
      const shotData = (await s("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      })) as { data: string };
      const file = `${OUT}/${name}.png`;
      await writeFile(file, Buffer.from(shotData.data, "base64"));
      console.log("wrote", file);
    }

    await shot("phase6-account-header-money", "/account", fixtures.moneyCookie);
    await shot("phase6-wallet-money", "/account/wallet", fixtures.moneyCookie, {
      height: 1100,
    });
    await shot(
      "phase6-registration-desktop",
      "/register/complete?next=%2Faccount",
      fixtures.incompleteCookie,
    );
    await shot(
      "phase6-registration-mobile",
      "/register/complete?next=%2Faccount",
      fixtures.incompleteCookie,
      { width: 390, height: 844 },
    );
    await shot(
      "phase6-profile-unverified-email",
      "/account/profile",
      fixtures.profileCookie,
      { height: 1200 },
    );

    // Request verification code then capture code input state
    const fake = new ConsoleEmailProvider();
    await requestEmailVerification({
      userId: fixtures.profileUserId,
      emailProvider: fake,
    });
    // Re-issue via UI click for visual state
    await shot(
      "phase6-profile-email-code",
      "/account/profile",
      fixtures.profileCookie,
      { height: 1300, click: ["تأیید ایمیل"], waitMs: 2500 },
    );

    // Mark verified and capture
    await prisma.user.update({
      where: { id: fixtures.profileUserId },
      data: { emailVerifiedAt: new Date() },
    });
    await shot(
      "phase6-profile-verified-email",
      "/account/profile",
      fixtures.profileCookie,
      { height: 1100 },
    );

    await shot(
      "phase6-checkout-money",
      fixtures.checkoutPath,
      fixtures.moneyCookie,
      { height: 1200 },
    );

    await send("Browser.close").catch(() => undefined);
    browserWs.close();
  } catch (error) {
    console.error(error);
    console.error(stderr.join("").slice(-1500));
    process.exitCode = 1;
  } finally {
    chrome.kill("SIGKILL");
    await prisma.$disconnect();
  }
}

main();
