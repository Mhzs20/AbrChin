import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);

type TemporaryPostgres = {
  databaseUrl: string;
  cleanup: () => Promise<void>;
};

function randomIdentifier() {
  return randomBytes(7).toString("hex");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDockerPostgres(label: string): Promise<TemporaryPostgres> {
  const suffix = `${label}-${randomIdentifier()}`.replace(/[^a-z0-9-]/gi, "");
  const containerName = `abrchin-pg-${suffix}`.slice(0, 55);
  const database = `abrchin_${randomIdentifier()}`;
  const username = `billing_${randomIdentifier()}`;
  const password = randomBytes(24).toString("base64url");
  let started = false;
  const cleanup = async () => {
    if (!started) return;
    await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => undefined);
    started = false;
    console.log("[postgres-isolation] temporary PostgreSQL container removed");
  };
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"]);
    await execFileAsync("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_DB=${database}`,
      "-e",
      `POSTGRES_USER=${username}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ]);
    started = true;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await execFileAsync("docker", [
          "exec",
          containerName,
          "pg_isready",
          "-U",
          username,
          "-d",
          database,
        ]);
        const { stdout } = await execFileAsync("docker", [
          "port",
          containerName,
          "5432/tcp",
        ]);
        const port = stdout.trim().split(":").at(-1)?.trim();
        if (!port || !/^\d+$/.test(port)) {
          throw new Error("temporary_postgres_port_unavailable");
        }
        console.log("[postgres-isolation] temporary PostgreSQL container ready");
        return {
          databaseUrl: `postgresql://${username}:${password}@127.0.0.1:${port}/${database}`,
          cleanup,
        };
      } catch {
        await delay(500);
      }
    }
    throw new Error("temporary_postgres_start_timeout");
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function resolveTemporaryPostgres(label: string) {
  try {
    return await startDockerPostgres(label);
  } catch (dockerError) {
    const fallbackUrl = process.env.POSTGRES_TEST_DATABASE_URL;
    if (!fallbackUrl) {
      throw new Error(
        `isolated PostgreSQL requires Docker or POSTGRES_TEST_DATABASE_URL: ${
          dockerError instanceof Error ? dockerError.message : "docker_unavailable"
        }`,
      );
    }
    // A caller that deliberately supplies this variable owns a dedicated test
    // database. We still create and remove a private schema below.
    return {
      databaseUrl: fallbackUrl,
      cleanup: async () => undefined,
    };
  }
}

export async function withTemporaryPostgres<T>(
  label: string,
  operation: (databaseUrl: string) => Promise<T>,
) {
  const temporary = await resolveTemporaryPostgres(label);
  try {
    return await operation(temporary.databaseUrl);
  } finally {
    await temporary.cleanup();
  }
}

export async function withIsolatedPostgres<T>(
  label: string,
  operation: (databaseUrl: string) => Promise<T>,
) {
  return withTemporaryPostgres(label, async (baseUrl) => {
    const databaseUrl = new URL(baseUrl);
    const schemaName = `abrchin_${label}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    databaseUrl.searchParams.set("schema", schemaName);
    const isolatedUrl = databaseUrl.toString();
    const admin = new PrismaClient({
      datasources: { db: { url: isolatedUrl } },
    });
    try {
      await execFileAsync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["prisma", "migrate", "deploy"],
        {
          env: { ...process.env, DATABASE_URL: isolatedUrl },
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return await operation(isolatedUrl);
    } finally {
      await admin
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await admin.$disconnect();
    }
  });
}
