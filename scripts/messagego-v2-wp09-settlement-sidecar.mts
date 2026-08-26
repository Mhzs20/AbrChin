import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  LedgerType,
  UserAccountStatus,
  WalletStatus,
} from "@prisma/client";

const httpPort = Number.parseInt(process.env.WP09_HTTP_PORT || "0", 10);
const pgPort = Number.parseInt(process.env.WP09_PG_PORT || "55436", 10);
const credential = process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL || "";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.ABRCHIN_ISOLATED_TEST = "1";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "isolated_postgres_test_secret_2026";
process.env.CREDENTIAL_ENCRYPTION_KEY =
  process.env.CREDENTIAL_ENCRYPTION_KEY ||
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.PAYMENT_CALLBACK_BASE_URL =
  process.env.PAYMENT_CALLBACK_BASE_URL || "http://127.0.0.1:3010";

const databaseUrl =
  `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres?pgbouncer=true&connection_limit=10&pool_timeout=30`;
process.env.DATABASE_URL = databaseUrl;

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

function parseOperation(body: Buffer) {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { operation?: unknown };
    return typeof parsed.operation === "string" ? parsed.operation.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

async function main() {
  if (credential.length < 32) {
    throw new Error("MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL must be at least 32 characters");
  }
  const database = await PGlite.create("memory://");
  const socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: pgPort,
    maxConnections: 40,
  });
  await socket.start();
  await run("./node_modules/.bin/prisma", ["migrate", "deploy"]);

  const { handleSettlementHttp } = await import("../lib/messagego/settlement/http.ts");
  const { prisma } = await import("../lib/db.ts");
  const { getCustomerAiSurface, handoffCustomerProviderCredential } = await import(
    "../lib/messagego/customer/surface.ts"
  );
  const { creditWallet } = await import("../lib/wallet/ledger.ts");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/__wp09__/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/__wp09__/account") {
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
      if (req.method === "GET" && url.pathname === "/__wp09__/wallet") {
        const accountId = url.searchParams.get("account_id") || "";
        const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: accountId } });
        const ledger = await prisma.walletLedgerEntry.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true, amount: true, idempotencyKey: true },
        });
        const reservations = await prisma.messageGoAuthorityReservation.findMany({
          where: { accountId },
          select: {
            id: true,
            status: true,
            productId: true,
            workspaceId: true,
            runId: true,
            usageReservationId: true,
            holdAmountRial: true,
            remainingHoldRial: true,
            settledAmountRial: true,
          },
        });
        json(res, 200, {
          available_balance_rial: wallet.availableBalance.toString(10),
          ledger_count: ledger.length,
          ledger_entry_ids: ledger.map((row) => row.id),
          ledger: ledger.map((row) => ({
            id: row.id,
            type: row.type,
            amount: row.amount.toString(10),
            idempotency_key: row.idempotencyKey,
          })),
          reservations: reservations.map((row) => ({
            ...row,
            holdAmountRial: row.holdAmountRial.toString(10),
            remainingHoldRial: row.remainingHoldRial.toString(10),
            settledAmountRial: row.settledAmountRial.toString(10),
          })),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/__wp09__/surface") {
        const accountId = url.searchParams.get("account_id") || "";
        const surface = await getCustomerAiSurface(accountId);
        json(res, 200, surface);
        return;
      }
      if (req.method === "POST" && url.pathname === "/__wp09__/handoff") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as {
          account_id: string;
          product_id?: string;
          workspace_id?: string;
          credential: string;
        };
        const result = await handoffCustomerProviderCredential({
          userId: body.account_id,
          productId: body.product_id || "prod_a",
          workspaceId: body.workspace_id || "ws_a",
          alias: "default",
          ownershipMode: "ACCOUNT_BYOK",
          familyAlias: "openai",
          credential: body.credential,
        });
        json(res, 200, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/__wp09__/topup") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as {
          account_id: string;
          amount_rial: string;
          idempotency_key: string;
        };
        const entry = await creditWallet({
          userId: body.account_id,
          amountRial: BigInt(body.amount_rial),
          type: LedgerType.TOP_UP,
          idempotencyKey: body.idempotency_key,
          referenceType: "wp09_test_topup",
          description: "WP09 wallet primitive regression",
        });
        json(res, 200, { id: entry.id, type: entry.type });
        return;
      }
      if (url.pathname === "/api/internal/messagego/v2/settlement") {
        const body = await readBody(req);
        const fault = (req.headers["x-wp09-fault"] || "").toString().toLowerCase();
        const operation = parseOperation(body);
        if (fault === "drop") {
          req.socket.destroy();
          return;
        }
        if (fault === "delay" && operation !== "reserve") {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (fault === "delay-reserve" && operation === "reserve") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          req.socket.destroy();
          return;
        }
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
  const ready = {
    http: `http://127.0.0.1:${port}`,
    pg: pgPort,
  };
  process.stdout.write(`WP09_SIDECAR_READY ${JSON.stringify(ready)}\n`);

  const shutdown = async () => {
    server.close();
    await socket.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
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
