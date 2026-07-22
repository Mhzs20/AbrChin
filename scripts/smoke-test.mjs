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
  ["/", "بگو چی می‌سازی"],
  ["/compass", "چی داری می‌سازی"],
  ["/compass?project=commerce&management=managed", "الان کجای کاری"],
  ["/solutions", "راهکار آماده"],
  ["/support", "هرچقدر لازم داری"],
  ["/about", "فقط سرور نمی‌فروشیم"],
  ["/help", "قبل از خرید"],
  ["/api/health", '"status":"ok"'],
  ["/robots.txt", "sitemap"],
  ["/sitemap.xml", "https://abrchin.ir/compass"],
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
    if (!response.ok || !body.includes(expectedText)) {
      throw new Error(`${route} failed: status=${response.status}, expected=${expectedText}`);
    }
    console.log(`✓ ${route}`);
  }

  for (const asset of ["/assets/fonts/Mikhak-DS1-Medium.ttf", "/assets/fonts/Mikhak-DS1-Black.ttf", "/assets/abrchin-logo.svg"]) {
    const response = await fetch(`${origin}${asset}`);
    if (!response.ok) throw new Error(`${asset} failed: status=${response.status}`);
    console.log(`✓ ${asset}`);
  }
} finally {
  server.kill("SIGTERM");
}
