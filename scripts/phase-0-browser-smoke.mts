import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import type { Browser } from "playwright";

const root = process.cwd();
// PGlite's socket adapter multiplexes clients over one backend; pooler mode
// prevents Prisma clients in the test runner and Next.js from colliding on
// prepared-statement names. Production connection settings are untouched.
const databaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:55432/postgres?pgbouncer=true&connection_limit=1";
const appOrigin = "http://127.0.0.1:3010";
const evidenceDir = join(root, "docs/launch/evidence/phase-0");
const phase1EvidenceDir = join(root, "docs/launch/evidence/phase-1");
const phase2EvidenceDir = join(root, "docs/launch/evidence/phase-2");
const phase4EvidenceDir = join(root, "docs/launch/evidence/phase-4");
const phase8EvidenceDir = join(root, "docs/launch/evidence/phase-8");
const phase2SaleEnabled = process.env.PHASE2_ONLY === "true";

const safeEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: "phase0_browser_session_secret_2026",
  CREDENTIAL_ENCRYPTION_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ADMIN_MOBILES: "09120000000",
  SMS_PROVIDER: "console",
  EMAIL_PROVIDER: "console",
  PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER: "mock",
  PAYMENT_CALLBACK_BASE_URL: appOrigin,
  INFRASTRUCTURE_PROVIDER_MODE: "mock",
  PUBLIC_SALE_ENABLED: phase2SaleEnabled ? "true" : "false",
  PARSPACK_ENABLED: phase2SaleEnabled ? "true" : "false",
  PARSPACK_API_VERSION: "v1",
  PARSPACK_API_TOKEN: "phase2_browser_local_only_token",
  PARSPACK_PUBLIC_API_BASE_URL: "https://api.parspack.com/api/public/v1",
  PARSPACK_PUBLIC_SALE_ENABLED: phase2SaleEnabled ? "true" : "false",
  PARSPACK_MUTATIONS_ENABLED: "false",
  ARVAN_ENABLED: "false",
  ARVAN_PUBLIC_SALE_ENABLED: "false",
  ARVAN_READY_PUBLIC_SALE_ENABLED: "false",
  ARVAN_CLOUD_PUBLIC_SALE_ENABLED: "false",
  MANUAL_READY_PUBLIC_SALE_ENABLED: "false",
  ARVAN_MUTATIONS_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(
  command: string,
  args: string[],
  options: { capture?: boolean } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: safeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!options.capture) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!options.capture) process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}

async function waitForApp(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appOrigin}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next app did not become ready: ${String(lastError)}`);
}

async function businessCounts(prisma: PrismaClient) {
  const [
    recommendationSessions,
    recommendationQuotes,
    serviceOrders,
    orderPayments,
    paymentAttempts,
    walletTopUps,
    ledgerEntries,
    infrastructureOrders,
    cloudInstances,
  ] = await Promise.all([
    prisma.recommendationSession.count(),
    prisma.recommendationQuote.count(),
    prisma.serviceOrder.count(),
    prisma.orderPayment.count(),
    prisma.paymentAttempt.count(),
    prisma.walletTopUp.count(),
    prisma.walletLedgerEntry.count(),
    prisma.infrastructureOrder.count(),
    prisma.cloudInstance.count(),
  ]);
  return {
    recommendationSessions,
    recommendationQuotes,
    serviceOrders,
    orderPayments,
    paymentAttempts,
    walletTopUps,
    ledgerEntries,
    infrastructureOrders,
    cloudInstances,
  };
}

async function main() {
  const phase1Only = process.env.PHASE1_ONLY === "true";
  const phase2Only = process.env.PHASE2_ONLY === "true";
  const phase4Only = process.env.PHASE4_ONLY === "true";
  const phase8Only = process.env.PHASE8_ONLY === "true";
  await mkdir(evidenceDir, { recursive: true });
  Object.assign(process.env, safeEnvironment);

  const db = await PGlite.create("memory://");
  const socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 55432,
    maxConnections: 40,
  });
  let appProcess: ReturnType<typeof spawn> | null = null;
  let browser: Browser | null = null;
  const prisma = new PrismaClient();

  try {
    await socket.start();
    console.log("[phase0-browser] database socket ready");
    await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);
    console.log("[phase0-browser] migrations applied");
    const seeded = await run(
      "node",
      [
        "--experimental-strip-types",
        "scripts/seed-phase0-browser-fixture.mts",
      ],
      { capture: true },
    );
    const fixture = JSON.parse(seeded.stdout.slice(seeded.stdout.indexOf("{")));
    const quotePath = `/cloud-servers/quote/${fixture.quoteId}`;
    console.log(`[phase0-browser] fixture ready: ${fixture.quoteId}`);

    const appLogs: string[] = [];
    appProcess = spawn(
      "./node_modules/.bin/next",
      ["dev", "-p", "3010", "-H", "127.0.0.1"],
      {
      cwd: root,
      env: safeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      },
    );
    appProcess.stdout.on("data", (chunk) => {
      appLogs.push(chunk.toString());
      process.stdout.write(chunk);
    });
    appProcess.stderr.on("data", (chunk) => {
      appLogs.push(chunk.toString());
      process.stderr.write(chunk);
    });
    await Promise.race([
      waitForApp(),
      new Promise<never>((_resolve, reject) => {
        appProcess!.once("exit", (code) => {
          reject(
            new Error(
              `Next.js exited before health check (code ${code})\n${appLogs.join("")}`,
            ),
          );
        });
      }),
    ]);
    console.log("[phase0-browser] Next.js health check passed");

    const browserTmp = await mkdtemp(join(tmpdir(), "abrchin-browser-"));
    process.env.TMPDIR = browserTmp;
    process.env.XDG_CACHE_HOME = join(browserTmp, "cache");
    process.env.FONTCONFIG_PATH = "/etc/fonts";
    await mkdir(process.env.XDG_CACHE_HOME, { recursive: true });
    const [{ chromium }, { inflate }] = await Promise.all([
      import("playwright"),
      import("@sparticuz/chromium"),
    ]);
    const chromiumPath = await inflate(
      join(root, "node_modules/@sparticuz/chromium/bin/chromium.br"),
    );
    console.log("[phase0-browser] Chromium binary ready");
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
      ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
    });
    console.log("[phase0-browser] Chromium launched");

    const before = await businessCounts(prisma);
    const scenarios = phase1Only || phase2Only || phase4Only || phase8Only ? [] : [
      {
        name: "home",
        path: "/",
        expectedText: "دیدن چینش‌های سرور",
      },
      {
        name: "catalog",
        path: "/cloud-servers",
        expectedText: "فروش عمومی هنوز فعال نیست",
      },
      {
        name: "quote",
        path: quotePath,
        expectedText: "فروش عمومی هنوز فعال نشده است",
      },
    ];
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ];
    const results: Array<Record<string, unknown>> = [];

    for (const viewport of viewports) {
      for (const scenario of scenarios) {
        console.log(
          `[phase0-browser] ${scenario.name} ${viewport.width}x${viewport.height}`,
        );
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        // The sandbox cannot reach Enamad, but the page must still prove that
        // its CSP permits only the exact trust-seal origin. Fulfil that one
        // image locally; any CSP regression continues to surface in console.
        await context.route("https://trustseal.enamad.ir/**", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
              "base64",
            ),
          });
        });
        await context.addCookies([
          {
            name: "abrchin_session",
            value: fixture.sessionToken,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];
        const serverErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("requestfailed", (request) => {
          if (request.url().startsWith(appOrigin)) {
            failedRequests.push(`${request.method()} ${request.url()}`);
          }
        });
        page.on("response", (response) => {
          if (response.url().startsWith(appOrigin) && response.status() >= 500) {
            serverErrors.push(`${response.status()} ${response.url()}`);
          }
        });

        const response = await page.goto(`${appOrigin}${scenario.path}`, {
          waitUntil: "domcontentloaded",
        });
        assert.equal(response?.status(), 200);
        assert.equal(new URL(page.url()).pathname, scenario.path);
        await page.locator("h1").waitFor({ state: "visible" });
        assert.ok((await page.locator("h1").innerText()).trim().length > 0);
        await page.getByText(scenario.expectedText, { exact: false }).first().waitFor({
          state: "visible",
        });
        assert.ok((await page.title()).trim().length > 0);
        const overflow = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        assert.ok(
          overflow.content <= overflow.viewport + 1,
          `horizontal overflow on ${scenario.path}: ${JSON.stringify(overflow)}`,
        );
        assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
        assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
        assert.equal(failedRequests.length, 0, failedRequests.join("\n"));
        assert.equal(serverErrors.length, 0, serverErrors.join("\n"));
        if (scenario.name !== "home") {
          assert.equal(
            await page.getByRole("button", { name: /ثبت سفارش|پرداخت/ }).count(),
            0,
          );
        }

        const screenshot = join(
          evidenceDir,
          `${scenario.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: false });
        results.push({
          route: scenario.path,
          viewport: `${viewport.width}x${viewport.height}`,
          status: response?.status(),
          title: await page.title(),
          heading: await page.locator("h1").innerText(),
          overflow,
          consoleErrors,
          pageErrors,
          failedRequests,
          serverErrors,
          screenshot: screenshot.slice(root.length + 1),
          result: "PASS",
        });
        await context.close();
      }
    }

    const after = await businessCounts(prisma);
    assert.deepEqual(after, before, "GET/browser baseline mutated business resources");
    if (!phase1Only && !phase2Only && !phase4Only && !phase8Only) {
      await writeFile(
        join(evidenceDir, "browser-results.json"),
        JSON.stringify(
          {
            fixture: {
              source: fixture.source,
              quoteId: fixture.quoteId,
              userId: fixture.userId,
            },
            publicSaleEnabled: false,
            providerMutationEnabled: false,
            countsBefore: before,
            countsAfter: after,
            results,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(`Phase 0 browser baseline passed: ${results.length} scenarios`);
    }

    if (process.env.INCLUDE_PHASE1_DISCOVERY === "true") {
      await mkdir(phase1EvidenceDir, { recursive: true });
      const discoveryResults: Array<Record<string, unknown>> = [];
      const beforeDiscovery = await businessCounts(prisma);

      for (const viewport of viewports) {
        console.log(
          `[phase1-browser] home → Compass ${viewport.width}x${viewport.height}`,
        );
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        await context.route("https://trustseal.enamad.ir/**", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
              "base64",
            ),
          });
        });
        await context.addCookies([
          {
            name: "abrchin_session",
            value: fixture.sessionToken,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];
        const serverErrors: string[] = [];
        let sessionPosts = 0;
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            request.url() === `${appOrigin}/api/recommendations/sessions`
          ) {
            sessionPosts += 1;
          }
        });
        page.on("requestfailed", (request) => {
          if (request.url().startsWith(appOrigin)) {
            failedRequests.push(`${request.method()} ${request.url()}`);
          }
        });
        page.on("response", (response) => {
          if (response.url().startsWith(appOrigin) && response.status() >= 500) {
            serverErrors.push(`${response.status()} ${response.url()}`);
          }
        });

        await page.goto(`${appOrigin}/`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "فروش آنلاین" }).click();
        const projectLink = page.getByRole("link", {
          name: "گرفتن پیشنهاد متناسب",
        });
        assert.equal(
          await projectLink.getAttribute("href"),
          "/compass?project=commerce",
        );
        const homeScreenshot = join(
          phase1EvidenceDir,
          `project-choice-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: homeScreenshot, fullPage: false });
        await projectLink.click();
        await page.waitForURL(`${appOrigin}/compass?project=commerce`);
        const understanding = page.getByText("برداشت من اینه که", {
          exact: false,
        });
        await understanding.waitFor({
          state: "visible",
        });
        assert.match(await understanding.innerText(), /فروشگاه آنلاین/);
        assert.equal(sessionPosts, 1, "Compass must create exactly one seeded session");
        const seededSession = await prisma.recommendationSession.findFirst({
          where: { userId: fixture.userId },
          orderBy: { createdAt: "desc" },
        });
        const seededAnswers = seededSession?.answers as
          | Record<string, unknown>
          | undefined;
        const seededSources = seededSession?.answerSources as
          | Record<string, unknown>
          | undefined;
        assert.equal(seededAnswers?.project, "commerce");
        assert.equal(seededSources?.project, "user");
        const overflow = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        assert.ok(overflow.content <= overflow.viewport + 1);
        assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
        assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
        assert.equal(failedRequests.length, 0, failedRequests.join("\n"));
        assert.equal(serverErrors.length, 0, serverErrors.join("\n"));
        const compassScreenshot = join(
          phase1EvidenceDir,
          `compass-prefill-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: compassScreenshot, fullPage: false });
        discoveryResults.push({
          viewport: `${viewport.width}x${viewport.height}`,
          href: "/compass?project=commerce",
          sessionPosts,
          recommendationSessionId: seededSession?.id,
          storedProject: seededAnswers?.project,
          storedSource: seededSources?.project,
          overflow,
          consoleErrors,
          pageErrors,
          failedRequests,
          serverErrors,
          screenshots: [
            homeScreenshot.slice(root.length + 1),
            compassScreenshot.slice(root.length + 1),
          ],
          result: "PASS",
        });
        await context.close();
      }

      const afterDiscovery = await businessCounts(prisma);
      assert.equal(
        afterDiscovery.recommendationSessions,
        beforeDiscovery.recommendationSessions + viewports.length,
      );
      for (const key of Object.keys(beforeDiscovery) as Array<
        keyof typeof beforeDiscovery
      >) {
        if (key === "recommendationSessions") continue;
        assert.equal(afterDiscovery[key], beforeDiscovery[key], `${key} changed`);
      }
      await writeFile(
        join(phase1EvidenceDir, "browser-results.json"),
        JSON.stringify(
          {
            project: "commerce",
            mutation: "explicit POST /api/recommendations/sessions",
            countsBefore: beforeDiscovery,
            countsAfter: afterDiscovery,
            results: discoveryResults,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Phase 1 discovery browser passed: ${discoveryResults.length} viewports`,
      );
    }

    if (phase2Only) {
      await mkdir(phase2EvidenceDir, { recursive: true });
      const beforeContinuity = await businessCounts(prisma);
      const continuityResults: Array<Record<string, unknown>> = [];

      for (const [index, viewport] of viewports.entries()) {
        const guest = fixture.guests[index] as {
          label: string;
          guestToken: string;
          sessionId: string;
          quoteId: string;
        };
        const quotePath = `/cloud-servers/quote/${guest.quoteId}`;
        console.log(
          `[phase2-browser] guest Quote → claim ${viewport.width}x${viewport.height}`,
        );
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        await context.route("https://trustseal.enamad.ir/**", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
              "base64",
            ),
          });
        });
        await context.addCookies([
          {
            name: "abrchin_recommendation_guest",
            value: guest.guestToken,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];
        const serverErrors: string[] = [];
        let expectedGuestAuthProbe401 = 0;
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("requestfailed", (request) => {
          if (request.url().startsWith(appOrigin)) {
            failedRequests.push(`${request.method()} ${request.url()}`);
          }
        });
        page.on("response", (response) => {
          if (
            response.url() === `${appOrigin}/api/auth/me` &&
            response.status() === 401
          ) {
            expectedGuestAuthProbe401 += 1;
          }
          if (response.url().startsWith(appOrigin) && response.status() >= 500) {
            serverErrors.push(`${response.status()} ${response.url()}`);
          }
        });

        const immutableBefore = await prisma.recommendationQuote.findUnique({
          where: { id: guest.quoteId },
          select: {
            planSnapshot: true,
            deliveryConfigurationSnapshot: true,
            profileSnapshot: true,
            lineItemsSnapshot: true,
            amountRial: true,
            renewalAmountRial: true,
            termMonths: true,
            termDiscountBps: true,
            expiresAt: true,
            status: true,
          },
        });
        assert.ok(immutableBefore);
        const response = await page.goto(`${appOrigin}${quotePath}`, {
          waitUntil: "domcontentloaded",
        });
        assert.equal(response?.status(), 200);
        await page.getByText("پیش‌فاکتور قفل شد", { exact: false }).waitFor({
          state: "visible",
        });
        const loginLink = page.getByRole("link", { name: "ورود و ادامه خرید" });
        const expectedLoginHref = `/login?next=${encodeURIComponent(quotePath)}`;
        assert.equal(await loginLink.getAttribute("href"), expectedLoginHref);
        await page.getByText("Ubuntu 24.04 LTS", { exact: true }).waitFor({
          state: "visible",
        });
        const guestScreenshot = join(
          phase2EvidenceDir,
          `guest-quote-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: guestScreenshot, fullPage: false });

        await context.addCookies([
          {
            name: "abrchin_session",
            value: fixture.sessionToken,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const claim = await page.evaluate(async () => {
          const result = await fetch("/api/recommendations/sessions/claim", {
            method: "POST",
          });
          return { status: result.status, body: await result.json() };
        });
        assert.equal(claim.status, 200);
        assert.equal(
          (claim.body as { claimed?: boolean }).claimed,
          true,
        );
        const claimedSession = await prisma.recommendationSession.findUnique({
          where: { id: guest.sessionId },
        });
        assert.equal(claimedSession?.userId, fixture.userId);
        assert.equal(claimedSession?.guestAccessTokenHash, null);
        assert.ok(claimedSession?.claimedAt);
        const immutableAfter = await prisma.recommendationQuote.findUnique({
          where: { id: guest.quoteId },
          select: {
            planSnapshot: true,
            deliveryConfigurationSnapshot: true,
            profileSnapshot: true,
            lineItemsSnapshot: true,
            amountRial: true,
            renewalAmountRial: true,
            termMonths: true,
            termDiscountBps: true,
            expiresAt: true,
            status: true,
          },
        });
        assert.deepEqual(immutableAfter, immutableBefore);
        const guestCookie = (await context.cookies()).find(
          (cookie) => cookie.name === "abrchin_recommendation_guest",
        );
        assert.equal(guestCookie, undefined);

        await page.goto(`${appOrigin}${quotePath}`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByText("موجودی فعلی کیف پول", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        const authenticatedScreenshot = join(
          phase2EvidenceDir,
          `claimed-quote-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: authenticatedScreenshot, fullPage: false });
        const overflow = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        assert.ok(overflow.content <= overflow.viewport + 1);
        const unexpectedConsoleErrors = [...consoleErrors];
        for (let index = 0; index < expectedGuestAuthProbe401; index += 1) {
          const expectedIndex = unexpectedConsoleErrors.findIndex((message) =>
            message.includes("status of 401 (Unauthorized)"),
          );
          if (expectedIndex >= 0) unexpectedConsoleErrors.splice(expectedIndex, 1);
        }
        assert.equal(
          unexpectedConsoleErrors.length,
          0,
          unexpectedConsoleErrors.join("\n"),
        );
        assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
        assert.equal(failedRequests.length, 0, failedRequests.join("\n"));
        assert.equal(serverErrors.length, 0, serverErrors.join("\n"));
        continuityResults.push({
          viewport: `${viewport.width}x${viewport.height}`,
          quotePath,
          loginHref: expectedLoginHref,
          claimStatus: claim.status,
          claimedSessionId: guest.sessionId,
          claimedUserId: claimedSession?.userId,
          guestCookieCleared: guestCookie == null,
          immutableQuotePreserved: true,
          overflow,
          consoleErrors,
          pageErrors,
          failedRequests,
          serverErrors,
          expectedGuestAuthProbe401,
          screenshots: [
            guestScreenshot.slice(root.length + 1),
            authenticatedScreenshot.slice(root.length + 1),
          ],
          result: "PASS",
        });
        await context.close();
      }

      const afterContinuity = await businessCounts(prisma);
      assert.deepEqual(afterContinuity, beforeContinuity);
      await writeFile(
        join(phase2EvidenceDir, "browser-results.json"),
        JSON.stringify(
          {
            publicSaleEnabled: true,
            providerMutationEnabled: false,
            countsBefore: beforeContinuity,
            countsAfter: afterContinuity,
            results: continuityResults,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Phase 2 guest/auth browser passed: ${continuityResults.length} viewports`,
      );
    }

    if (phase4Only) {
      await mkdir(phase4EvidenceDir, { recursive: true });
      const beforeTracking = await businessCounts(prisma);
      const trackingResults: Array<Record<string, unknown>> = [];
      const orderPath = `/account/orders/${fixture.trackingOrderId}`;
      const cancelPath = `/account/support/requests/new?orderId=${fixture.trackingOrderId}&intent=cancel-before-delivery`;

      for (const viewport of viewports) {
        console.log(
          `[phase4-browser] order tracking ${viewport.width}x${viewport.height}`,
        );
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        await context.route("https://trustseal.enamad.ir/**", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
              "base64",
            ),
          });
        });
        await context.addCookies([
          {
            name: "abrchin_session",
            value: fixture.sessionToken,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const failedRequests: string[] = [];
        const serverErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("requestfailed", (request) => {
          if (request.url().startsWith(appOrigin)) {
            failedRequests.push(`${request.method()} ${request.url()}`);
          }
        });
        page.on("response", (response) => {
          if (response.url().startsWith(appOrigin) && response.status() >= 500) {
            serverErrors.push(`${response.status()} ${response.url()}`);
          }
        });

        const response = await page.goto(`${appOrigin}${orderPath}`, {
          waitUntil: "domcontentloaded",
        });
        assert.equal(response?.status(), 200);
        await page.getByText("اقدام بعدی", { exact: true }).waitFor();
        await page
          .getByRole("heading", { name: "تأیید ساخت توسط ابرچین" })
          .waitFor();
        const cancelLink = page.getByRole("link", {
          name: "ثبت درخواست لغو پیش از تحویل",
        });
        assert.equal(await cancelLink.getAttribute("href"), cancelPath);
        const orderScreenshot = join(
          phase4EvidenceDir,
          `order-tracking-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: orderScreenshot, fullPage: false });

        const refreshResponse = page.waitForResponse((candidate) => {
          const url = new URL(candidate.url());
          return (
            url.pathname === orderPath &&
            candidate.status() === 200 &&
            candidate.request().resourceType() === "fetch"
          );
        });
        await page
          .getByRole("button", { name: "به‌روزرسانی وضعیت" })
          .click();
        await refreshResponse;

        await cancelLink.click();
        await page.waitForURL(`${appOrigin}${cancelPath}`);
        assert.equal(await page.locator("#support-category").inputValue(), "CHANGE");
        assert.equal(
          await page.locator("#support-subject").inputValue(),
          "درخواست لغو پیش از تحویل",
        );
        assert.match(
          await page.locator("#support-description").inputValue(),
          /لغو امن این سفارش/,
        );
        const formScreenshot = join(
          phase4EvidenceDir,
          `cancel-request-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ path: formScreenshot, fullPage: false });
        const overflow = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        assert.ok(overflow.content <= overflow.viewport + 1);
        assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
        assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
        assert.equal(failedRequests.length, 0, failedRequests.join("\n"));
        assert.equal(serverErrors.length, 0, serverErrors.join("\n"));
        trackingResults.push({
          viewport: `${viewport.width}x${viewport.height}`,
          orderPath,
          refreshObserved: true,
          nextAction: "تأیید ساخت توسط ابرچین",
          cancelPath,
          cancelFormPrefilled: true,
          overflow,
          consoleErrors,
          pageErrors,
          failedRequests,
          serverErrors,
          screenshots: [
            orderScreenshot.slice(root.length + 1),
            formScreenshot.slice(root.length + 1),
          ],
          result: "PASS",
        });
        await context.close();
      }

      const afterTracking = await businessCounts(prisma);
      assert.deepEqual(afterTracking, beforeTracking);
      await writeFile(
        join(phase4EvidenceDir, "browser-results.json"),
        JSON.stringify(
          {
            mutation: "none — refresh and prefilled form GET only",
            countsBefore: beforeTracking,
            countsAfter: afterTracking,
            results: trackingResults,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Phase 4 order tracking browser passed: ${trackingResults.length} viewports`,
      );
    }

    if (phase8Only) {
      await mkdir(phase8EvidenceDir, { recursive: true });
      const beforeAccessibility = await businessCounts(prisma);
      const accessibilityResults: Array<Record<string, unknown>> = [];
      const routes = [
        { name: "home", path: "/" },
        { name: "catalog", path: "/cloud-servers" },
        { name: "support", path: "/support" },
        { name: "quote", path: quotePath },
        {
          name: "order",
          path: `/account/orders/${fixture.trackingOrderId}`,
        },
        { name: "parchin", path: "/account/parchin" },
        {
          name: "support-form",
          path: `/account/support/requests/new?orderId=${fixture.trackingOrderId}&intent=cancel-before-delivery`,
        },
      ];

      for (const viewport of viewports) {
        for (const route of routes) {
          console.log(
            `[phase8-browser] ${route.name} accessibility ${viewport.width}x${viewport.height}`,
          );
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
          });
          await context.route("https://trustseal.enamad.ir/**", async (request) => {
            await request.fulfill({
              status: 200,
              contentType: "image/png",
              body: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n6sAAAAASUVORK5CYII=",
                "base64",
              ),
            });
          });
          await context.addCookies([
            {
              name: "abrchin_session",
              value: fixture.sessionToken,
              domain: "127.0.0.1",
              path: "/",
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          const failedRequests: string[] = [];
          const serverErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => pageErrors.push(error.message));
          page.on("requestfailed", (request) => {
            if (request.url().startsWith(appOrigin)) {
              failedRequests.push(`${request.method()} ${request.url()}`);
            }
          });
          page.on("response", (response) => {
            if (response.url().startsWith(appOrigin) && response.status() >= 500) {
              serverErrors.push(`${response.status()} ${response.url()}`);
            }
          });

          const response = await page.goto(`${appOrigin}${route.path}`, {
            waitUntil: "domcontentloaded",
          });
          assert.equal(response?.status(), 200);
          await page.locator("h1").waitFor({ state: "visible" });
          const audit = await page.evaluate(() => {
            const isVisible = (element: Element) => {
              const node = element as HTMLElement;
              const style = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            };
            const textFromIds = (value: string | null) =>
              (value ?? "")
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .join(" ")
                .trim();
            const accessibleName = (element: Element) => {
              const node = element as HTMLElement;
              const labels =
                "labels" in node && node.labels
                  ? Array.from(node.labels as NodeListOf<HTMLLabelElement>)
                      .map((label) => label.textContent?.trim() ?? "")
                      .join(" ")
                  : "";
              return (
                node.getAttribute("aria-label")?.trim() ||
                textFromIds(node.getAttribute("aria-labelledby")) ||
                labels ||
                node.textContent?.trim() ||
                node.getAttribute("alt")?.trim() ||
                node.getAttribute("title")?.trim() ||
                ""
              );
            };
            const interactive = Array.from(
              document.querySelectorAll(
                'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]',
              ),
            ).filter(isVisible);
            const fields = Array.from(
              document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
            ).filter(isVisible);
            const ids = Array.from(document.querySelectorAll("[id]"))
              .map((element) => element.id)
              .filter(Boolean);
            const duplicateIds = ids.filter(
              (id, index) => ids.indexOf(id) !== index,
            );
            const headings = Array.from(
              document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
            )
              .filter(isVisible)
              .map((heading) => ({
                level: Number(heading.tagName.slice(1)),
                text: heading.textContent?.trim() ?? "",
              }));
            const tooSmallControls = interactive
              .filter((element) =>
                element.matches("button, input, select, textarea, [role=button]"),
              )
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width < 24 || rect.height < 24;
              })
              .map((element) => element.outerHTML.slice(0, 160));
            return {
              language: document.documentElement.lang,
              direction: document.documentElement.dir,
              mainCount: document.querySelectorAll("main#main-content").length,
              h1Count: headings.filter((heading) => heading.level === 1).length,
              firstHeadingLevel: headings[0]?.level ?? null,
              emptyHeadings: headings.filter((heading) => !heading.text),
              unnamedInteractive: interactive
                .filter((element) => !accessibleName(element))
                .map((element) => element.outerHTML.slice(0, 160)),
              unlabeledFields: fields
                .filter((element) => !accessibleName(element))
                .map((element) => element.outerHTML.slice(0, 160)),
              missingImageAlt: Array.from(document.querySelectorAll("img"))
                .filter((image) => !image.hasAttribute("alt"))
                .map((image) => image.outerHTML.slice(0, 160)),
              duplicateIds: [...new Set(duplicateIds)],
              positiveTabindex: interactive
                .filter((element) => Number(element.getAttribute("tabindex")) > 0)
                .map((element) => element.outerHTML.slice(0, 160)),
              hiddenFocusable: interactive
                .filter((element) => element.closest('[aria-hidden="true"]'))
                .map((element) => element.outerHTML.slice(0, 160)),
              tooSmallControls,
              headings,
              overflow: {
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
              },
            };
          });

          assert.equal(audit.language, "fa");
          assert.equal(audit.direction, "rtl");
          assert.equal(audit.mainCount, 1);
          assert.equal(audit.h1Count, 1);
          assert.equal(audit.firstHeadingLevel, 1);
          assert.deepEqual(audit.emptyHeadings, []);
          assert.deepEqual(audit.unnamedInteractive, []);
          assert.deepEqual(audit.unlabeledFields, []);
          assert.deepEqual(audit.missingImageAlt, []);
          assert.deepEqual(audit.duplicateIds, []);
          assert.deepEqual(audit.positiveTabindex, []);
          assert.deepEqual(audit.hiddenFocusable, []);
          assert.deepEqual(audit.tooSmallControls, []);
          assert.ok(audit.overflow.content <= audit.overflow.viewport + 1);

          await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
            document.body.focus();
          });
          await page.keyboard.press("Tab");
          const focused = page.locator(":focus");
          assert.equal(await focused.getAttribute("href"), "#main-content");
          assert.match(
            (await focused.innerText()).trim(),
            /رفتن به محتوای اصلی/,
          );
          await page.waitForTimeout(220);
          const focusBox = await focused.boundingBox();
          assert.ok(focusBox && focusBox.y >= 0 && focusBox.height >= 24);

          assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
          assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
          assert.equal(failedRequests.length, 0, failedRequests.join("\n"));
          assert.equal(serverErrors.length, 0, serverErrors.join("\n"));

          const screenshot = join(
            phase8EvidenceDir,
            `${route.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`,
          );
          await page.screenshot({ path: screenshot, fullPage: false });
          accessibilityResults.push({
            route: route.path,
            viewport: `${viewport.width}x${viewport.height}`,
            heading: await page.locator("h1").innerText(),
            audit,
            skipLinkFocused: true,
            consoleErrors,
            pageErrors,
            failedRequests,
            serverErrors,
            screenshot: screenshot.slice(root.length + 1),
            result: "PASS",
          });
          await context.close();
        }
      }

      const afterAccessibility = await businessCounts(prisma);
      assert.deepEqual(
        afterAccessibility,
        beforeAccessibility,
        "Phase 8 GET/accessibility audit mutated business resources",
      );
      await writeFile(
        join(phase8EvidenceDir, "browser-results.json"),
        JSON.stringify(
          {
            mutation: "none — GET and keyboard focus audit only",
            countsBefore: beforeAccessibility,
            countsAfter: afterAccessibility,
            results: accessibilityResults,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `Phase 8 accessibility browser passed: ${accessibilityResults.length} route/viewports`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (appProcess) {
      appProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!appProcess.killed) appProcess.kill("SIGKILL");
    }
    await prisma.$disconnect().catch(() => undefined);
    await socket.stop().catch(() => undefined);
    await db.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
