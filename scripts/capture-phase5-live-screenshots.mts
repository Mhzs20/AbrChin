/**
 * Capture live AbrChin purchase-experience screenshots via Chrome CDP.
 * Requires fixtures JSON from seed-phase5-screenshot-fixtures.mts.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const BASE = process.env.ABRCHIN_BASE_URL ?? "http://localhost:3010";
const OUT = "/opt/cursor/artifacts/screenshots";
const seed = JSON.parse(await readFile("/tmp/phase5-seed-out.txt", "utf8"));
const cookie = String(seed.cookie).split("=").slice(1).join("=");

async function waitForWs(port: number) {
  for (let i = 0; i < 50; i++) {
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

async function main() {
  await mkdir(OUT, { recursive: true });
  const userData = `/tmp/chrome-phase5-${Date.now()}`;
  await mkdir(userData, { recursive: true });
  const port = 9333;

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
      browserWs.addEventListener("error", () =>
        reject(new Error("browser websocket failed")),
      );
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
      if (msg.error) p.reject(new Error(msg.error.message ?? "cdp error"));
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
    await s("Network.setCookie", {
      name: "abrchin_session",
      value: cookie,
      url: BASE,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });

    async function screenshot(
      name: string,
      urlPath: string,
      opts?: {
        width?: number;
        height?: number;
        clickIncludes?: string[];
        waitMs?: number;
        scrollSelector?: string;
      },
    ) {
      const width = opts?.width ?? 1280;
      const height = opts?.height ?? 900;
      await s("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 500,
      });
      await s("Page.navigate", { url: `${BASE}${urlPath}` });
      await delay(opts?.waitMs ?? 2200);

      if (opts?.scrollSelector) {
        await s("Runtime.evaluate", {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(opts.scrollSelector)});
            if (el) el.scrollIntoView({ block: "center" });
          })()`,
        });
        await delay(400);
      }

      if (opts?.clickIncludes?.length) {
        const clickExpr = `(() => {
          const needles = ${JSON.stringify(opts.clickIncludes)};
          const nodes = Array.from(document.querySelectorAll("button, a, [role='button']"));
          for (const needle of needles) {
            const el = nodes.find((n) => (n.textContent || "").includes(needle));
            if (el) { el.click(); return { ok: true, needle }; }
          }
          return {
            ok: false,
            texts: nodes.slice(0, 30).map((n) => (n.textContent || "").trim().slice(0, 60)),
          };
        })()`;
        const clicked = (await s("Runtime.evaluate", {
          expression: clickExpr,
          returnByValue: true,
        })) as { result: { value: { ok: boolean; needle?: string; texts?: string[] } } };
        console.log(`click ${name}:`, clicked.result.value);
        await delay(1500);
      }

      const shot = (await s("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      })) as { data: string };
      const file = `${OUT}/${name}.png`;
      await writeFile(file, Buffer.from(shot.data, "base64"));
      console.log(`wrote ${file}`);
    }

    await screenshot("configuration-desktop", seed.urls.configuration, {
      waitMs: 3200,
      scrollSelector: ".ready-server-delivery-config, .order-summary, #plan-" + seed.starterPlanId,
      height: 1400,
    });
    await screenshot("configuration-mobile", seed.urls.configuration, {
      width: 390,
      height: 1200,
      waitMs: 3200,
      scrollSelector: ".ready-server-delivery-config",
    });
    await screenshot("checkout-sufficient", seed.urls.checkoutSufficient, {
      height: 1200,
      scrollSelector: ".order-checkout",
    });
    await screenshot("checkout-insufficient", seed.urls.checkoutInsufficient, {
      height: 1400,
      scrollSelector: ".order-wallet-row--shortfall, .order-checkout-actions",
      waitMs: 2500,
    });
    await screenshot("quote-expired", seed.urls.quoteExpired);
    await screenshot("cancel-refund-preview", seed.urls.cancel, {
      scrollSelector: "#cancel-service",
      clickIncludes: [
        "محاسبه بازگشت اعتبار",
        "پیش‌نمایش بازگشت",
        "لغو سرویس",
        "بازگشت اعتبار",
        "محاسبه",
      ],
      waitMs: 2500,
    });
    await screenshot("upgrade-quote", seed.urls.upgradeQuote);

    await send("Browser.close").catch(() => undefined);
    browserWs.close();
  } catch (error) {
    console.error(error);
    console.error(stderr.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    chrome.kill("SIGKILL");
  }
}

main();
