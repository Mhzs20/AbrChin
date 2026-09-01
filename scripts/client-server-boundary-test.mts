import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("client AI connection form imports only browser-safe family constants", () => {
  const form = readFileSync("components/account/ai-connection-form.tsx", "utf8");
  assert.match(form, /from "@\/lib\/messagego\/customer\/families"/);
  assert.match(form, /from "@\/lib\/messagego\/customer\/view"/);
  assert.equal(form.includes("handoff"), false);
  assert.equal(form.includes("hmac"), false);
  assert.equal(form.includes("node:fs"), false);
  assert.equal(form.includes("loadKeyringFile"), false);
  assert.equal(form.includes("getEnv"), false);
});

test("HMAC keyring loading is server-only and is not dynamically imported", () => {
  const hmac = readFileSync("lib/messagego/s2s/hmac.ts", "utf8");
  const handoff = readFileSync("lib/messagego/customer/handoff.ts", "utf8");
  const families = readFileSync("lib/messagego/customer/families.ts", "utf8");
  assert.match(hmac, /import "server-only"/);
  assert.match(hmac, /from "node:fs"/);
  assert.match(handoff, /import "server-only"/);
  assert.match(handoff, /loadKeyringFile/);
  assert.equal(handoff.includes("await import("), false);
  assert.equal(handoff.includes('from "node:fs"'), false);
  assert.equal(families.includes("server-only"), false);
  assert.equal(families.includes("node:fs"), false);
  assert.equal(families.includes("hmac"), false);
});

test("no client component imports MessageGo HMAC, handoff, or node:fs", () => {
  const forbidden = [
    "lib/messagego/customer/handoff",
    "lib/messagego/s2s/hmac",
    "node:fs",
    "loadKeyringFile",
  ];
  for (const file of [...walk("components"), ...walk("app")]) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('"use client"') && !source.includes("'use client'")) {
      continue;
    }
    for (const token of forbidden) {
      assert.equal(
        source.includes(token),
        false,
        `${file} must not reference ${token}`,
      );
    }
  }
});
