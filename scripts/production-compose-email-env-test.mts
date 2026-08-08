/**
 * Production compose must wire Phase 6 email runtime into abrchin-web.
 * Uses a production-like env fixture (placeholders only — no real secrets).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const REQUIRED_WEB_EMAIL_KEYS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_TIMEOUT_MS",
  "EMAIL_VERIFICATION_TTL_SECONDS",
] as const;

async function writeProductionLikeFixture(dir: string) {
  const path = join(dir, "compose.production.fixture.env");
  const values: Record<string, string> = {
    ABRCHIN_IMAGE: "abrchin:compose-email-fixture",
    POSTGRES_DB: "abrchin",
    POSTGRES_USER: "abrchin",
    POSTGRES_PASSWORD: "placeholder_not_real",
    DATABASE_URL:
      "postgresql://abrchin:placeholder_not_real@db:5432/abrchin?schema=public",
    SESSION_SECRET: "placeholder_session_secret_16",
    CREDENTIAL_ENCRYPTION_KEY:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    SMS_PROVIDER: "kavenegar",
    KAVENEGAR_API_KEY: "",
    PAYMENT_CALLBACK_BASE_URL: "https://abrchin.ir",
    PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER: "zibal",
    ADMIN_MOBILES: "",
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "noreply@example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-placeholder",
    SMTP_TIMEOUT_MS: "10000",
    EMAIL_VERIFICATION_TTL_SECONDS: "600",
    WORKER_ID: "provisioning-worker",
    ABRCHIN_RUN_MIGRATE_ON_START: "false",
  };
  await writeFile(
    path,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  return { path, values };
}

function extractWebEnvironment(rendered: string): Record<string, string> {
  // docker compose config YAML: locate services.web.environment block.
  const lines = rendered.split("\n");
  let inWeb = false;
  let inEnv = false;
  let envIndent = -1;
  const env: Record<string, string> = {};
  for (const line of lines) {
    if (/^ {2}web:/.test(line)) {
      inWeb = true;
      inEnv = false;
      continue;
    }
    if (inWeb && /^ {2}[a-z0-9-]+:/.test(line) && !/^ {2}web:/.test(line)) {
      break;
    }
    if (inWeb && /^\s+environment:/.test(line)) {
      inEnv = true;
      envIndent = line.search(/\S/);
      continue;
    }
    if (inEnv) {
      const indent = line.search(/\S/);
      if (indent <= envIndent && line.trim() !== "") {
        inEnv = false;
        continue;
      }
      const match = line.match(/^\s+([A-Z0-9_]+):\s*(.*)$/);
      if (match) {
        env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
      }
    }
  }
  return env;
}

test("rendered production compose web.environment includes email runtime keys", async (t) => {
  let dockerOk = true;
  try {
    await execFileAsync("docker", ["compose", "version"]);
  } catch {
    dockerOk = false;
  }
  if (!dockerOk) {
    t.skip("docker compose unavailable");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "abrchin-compose-email-"));
  try {
    const { path: envFile, values: fixture } =
      await writeProductionLikeFixture(dir);
    // Shell env wins over --env-file for Compose interpolation; pass fixture
    // values explicitly so local .env cannot shadow EMAIL_PROVIDER=smtp.
    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        "compose.production.yaml",
        "config",
      ],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_HOST: process.env.DOCKER_HOST,
          ...fixture,
        },
        maxBuffer: 5 * 1024 * 1024,
      },
    );

    const webEnv = extractWebEnvironment(stdout);
    for (const key of REQUIRED_WEB_EMAIL_KEYS) {
      assert.ok(
        key in webEnv,
        `web.environment missing ${key} in rendered compose config`,
      );
    }
    assert.equal(webEnv.EMAIL_PROVIDER, "smtp");
    assert.equal(webEnv.SMTP_HOST, "smtp.example.com");
    assert.equal(webEnv.SMTP_PORT, "587");
    assert.equal(webEnv.EMAIL_VERIFICATION_TTL_SECONDS, "600");

    // Worker must not get SMTP wiring unless needed.
    const workerStart = stdout.indexOf("\n  worker:\n");
    const catalogStart = stdout.indexOf("\n  catalog-sync:\n");
    assert.ok(workerStart >= 0);
    const workerSlice = stdout.slice(
      workerStart,
      catalogStart > workerStart ? catalogStart : undefined,
    );
    assert.doesNotMatch(workerSlice, /\n\s+SMTP_HOST:/);
    assert.doesNotMatch(workerSlice, /\n\s+EMAIL_PROVIDER:/);

    // If a local image matching ABRCHIN_IMAGE exists, create abrchin-web and
    // confirm the container env receives the email runtime keys.
    let imagePresent = false;
    try {
      await execFileAsync("docker", ["image", "inspect", "abrchin:compose-email-fixture"]);
      imagePresent = true;
    } catch {
      imagePresent = false;
    }
    if (!imagePresent) {
      // Tag any existing abrchin image as the fixture tag when available.
      try {
        const { stdout: images } = await execFileAsync("docker", [
          "images",
          "abrchin",
          "--format",
          "{{.Repository}}:{{.Tag}}",
        ]);
        const first = images
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("abrchin:") && !line.endsWith(":<none>"));
        if (first) {
          await execFileAsync("docker", [
            "tag",
            first,
            "abrchin:compose-email-fixture",
          ]);
          imagePresent = true;
        }
      } catch {
        imagePresent = false;
      }
    }

    if (!imagePresent) {
      t.diagnostic(
        "skipping abrchin-web container env inspect (no local abrchin image)",
      );
      return;
    }

    const project = `abrchin_email_env_${Date.now().toString(36)}`;
    try {
      await execFileAsync(
        "docker",
        [
          "compose",
          "-p",
          project,
          "--env-file",
          envFile,
          "-f",
          "compose.production.yaml",
          "create",
          "web",
        ],
        {
          cwd: process.cwd(),
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            DOCKER_HOST: process.env.DOCKER_HOST,
            ...fixture,
          },
          maxBuffer: 5 * 1024 * 1024,
        },
      );
      // compose.production.yaml pins container_name: abrchin-web
      const { stdout: fixed } = await execFileAsync("docker", [
        "inspect",
        "-f",
        "{{range .Config.Env}}{{println .}}{{end}}",
        "abrchin-web",
      ]);
      const envList = fixed
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const key of REQUIRED_WEB_EMAIL_KEYS) {
        assert.ok(
          envList.some((entry) => entry.startsWith(`${key}=`)),
          `abrchin-web container missing env ${key}`,
        );
      }
      assert.ok(envList.includes("EMAIL_PROVIDER=smtp"));
      assert.ok(envList.includes("SMTP_HOST=smtp.example.com"));
      assert.ok(envList.includes("EMAIL_VERIFICATION_TTL_SECONDS=600"));
    } finally {
      await execFileAsync(
        "docker",
        [
          "compose",
          "-p",
          project,
          "--env-file",
          envFile,
          "-f",
          "compose.production.yaml",
          "down",
          "--remove-orphans",
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            DOCKER_HOST: process.env.DOCKER_HOST,
            ...fixture,
          },
        },
      ).catch(() => undefined);
      await execFileAsync("docker", ["rm", "-f", "abrchin-web"]).catch(
        () => undefined,
      );
      await execFileAsync("docker", ["rm", "-f", "abrchin-db"]).catch(
        () => undefined,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
