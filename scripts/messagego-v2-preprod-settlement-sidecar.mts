import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { UserAccountStatus, WalletStatus } from "@prisma/client";

const httpPort = Number.parseInt(process.env.PREPROD_HTTP_PORT || "0", 10);

if (!process.env.DATABASE_URL) {
  throw new Error("PREPROD sidecar requires a real DATABASE_URL");
}

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.ABRCHIN_ISOLATED_TEST = "1";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "isolated_postgres_test_secret_2026";
process.env.CREDENTIAL_ENCRYPTION_KEY =
  process.env.CREDENTIAL_ENCRYPTION_KEY ||
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.PAYMENT_CALLBACK_BASE_URL =
  process.env.PAYMENT_CALLBACK_BASE_URL || "http://127.0.0.1:3010";

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toFetchRequest(req: IncomingMessage, body: Buffer) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else headers.set(key, value);
  }
  const host = req.headers.host || "127.0.0.1";
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

async function writeFetchResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

async function main() {
  await run("./node_modules/.bin/prisma", ["generate"]);
  await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);
  const { handleSettlementHttp } = await import("../lib/messagego/settlement/http.ts");
  const { prisma } = await import("../lib/db.ts");
  const { ensureUnitCustomerPrice } = await import("../lib/messagego/settlement/customer-pricing.ts");
  await ensureUnitCustomerPrice(prisma);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/__preprod__/health") {
        json(res, 200, { ok: true, postgres: "real" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/__preprod__/account") {
        const body = await readBody(req);
        const parsed = body.length ? (JSON.parse(body.toString("utf8")) as { balance_rial?: string }) : {};
        const balance = BigInt(parsed.balance_rial || "1000");
        const mobile = `09${randomBytes(5).toString("hex").slice(0, 9)}`;
        const user = await prisma.user.create({
          data: { mobile, accountStatus: UserAccountStatus.ACTIVE },
        });
        const wallet = await prisma.wallet.create({
          data: {
            userId: user.id,
            availableBalance: balance,
            status: WalletStatus.ACTIVE,
          },
        });
        json(res, 200, {
          account_id: user.id,
          wallet_id: wallet.id,
          available_balance_rial: wallet.availableBalance.toString(10),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/__preprod__/wallet") {
        const accountId = url.searchParams.get("account_id") || "";
        const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: accountId } });
        json(res, 200, { available_balance_rial: wallet.availableBalance.toString(10) });
        return;
      }
      if (url.pathname === "/api/internal/messagego/v2/settlement") {
        const body = await readBody(req);
        const response = await handleSettlementHttp(toFetchRequest(req, body));
        await writeFetchResponse(res, response);
        return;
      }
      json(res, 404, { error: "not found", code: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "sidecar failed";
      const digest = createHash("sha256").update(message).digest("hex").slice(0, 12);
      json(res, 500, { error: "sidecar failed closed", code: "internal_error", ref: digest });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(httpPort, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : httpPort;
  process.stdout.write(`PREPROD_SIDECAR_READY ${JSON.stringify({ http: `http://127.0.0.1:${port}` })}\n`);

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
