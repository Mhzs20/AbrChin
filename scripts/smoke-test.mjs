import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const port = 3011;
const origin = `http://127.0.0.1:${port}`;
const server = spawn("./node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

const checks = [
  ["/", "زیرساختت رو سوار بر ابرها بساز"],
  ["/cloud-servers", "سرور ابری"],
  ["/ready-servers", "سرور ابری"],
  ["/compass", "سلام — من قطب‌نمای ابرچینم"],
  ["/compass?project=commerce", "سلام — من قطب‌نمای ابرچینم"],
  ["/solutions", "هر پروژه، چینش خودش رو می‌خواد"],
  ["/support", "سه سطح پرچین"],
  ["/about", "زیرساخت باید محکم باشه، نه سنگین"],
  ["/help", "قبل از فعال‌سازی، همه‌چیز روشن"],
  ["/login", "ورود به حساب ابرچین"],
  ["/api/health", '"status":"ok"'],
  ["/api/auth/me", "برای ادامه وارد شوید"],
  ["/api/wallet", "برای ادامه وارد شوید"],
  ["/robots.txt", "sitemap"],
  ["/sitemap.xml", "https://abrchin.ir/cloud-servers"],
];

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server stopped early.\n${serverLog}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await wait(100);
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
}

try {
  await waitForServer();

  for (const [route, expectedText] of checks) {
    const response = await fetch(`${origin}${route}`);
    const body = await response.text();
    const allowUnauthorized =
      (route === "/api/auth/me" || route === "/api/wallet") && response.status === 401;
    if ((!response.ok && !allowUnauthorized) || !body.includes(expectedText)) {
      throw new Error(`${route} failed: status=${response.status}, expected=${expectedText}`);
    }
    console.log(`✓ ${route}`);
  }

  for (const asset of [
    "/assets/fonts/Mikhak-DS1-Medium.ttf",
    "/assets/fonts/Mikhak-DS1-Black.ttf",
    "/assets/abrchin-logo.svg",
    "/assets/abrchin-system/icons/compute.svg",
  ]) {
    const response = await fetch(`${origin}${asset}`);
    if (!response.ok) throw new Error(`${asset} failed: status=${response.status}`);
    console.log(`✓ ${asset}`);
  }

  const account = await fetch(`${origin}/account`, { redirect: "manual" });
  if (account.status !== 307 && account.status !== 302) {
    throw new Error(`/account expected redirect for guest, got ${account.status}`);
  }
  const location = account.headers.get("location") || "";
  if (!location.includes("/login")) {
    throw new Error(`/account redirect location unexpected: ${location}`);
  }
  console.log("✓ /account guest redirect");
} finally {
  server.kill("SIGTERM");
}
