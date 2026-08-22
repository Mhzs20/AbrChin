/**
 * Guards the customer digit rule (P1-4).
 *
 * Every numeral a customer reads is Persian; specs use the same wording as the
 * server title (هسته / گیگ). Latin digits survive only in product names
 * (AlmaLinux 9) and customer-typed identifiers. Admin surfaces are exempt on
 * purpose — technical operators read technical units.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { faDigits, specGbFa, specVcpuFa } from "../lib/labels/customer.ts";

test("digit helpers produce Persian, title-consistent labels", () => {
  assert.equal(faDigits(12), "۱۲");
  assert.equal(faDigits("v2.5"), "v۲.۵");
  assert.equal(faDigits(null), "—");
  assert.equal(specVcpuFa(2), "۲ هسته");
  assert.equal(specVcpuFa(null), "—");
  assert.equal(specGbFa(40), "۴۰ گیگ");
  assert.equal(specGbFa(undefined), "—");
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Admin surfaces intentionally keep technical Latin units.
      if (path.includes("admin")) continue;
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

test("no customer-facing component renders Latin-digit specs", async () => {
  const files = [
    ...(await walk("components")),
    ...(await walk("app")),
  ];
  assert.ok(files.length > 30, "expected to scan the customer surface");

  const banned = [
    /\{[^{}]*\}\s*vCPU/, // {vcpu} vCPU
    /\{[^{}]*\}\s*GB/, // {ramGb} GB
    /\$\{[^{}]*\}\s*vCPU/, // `${vcpu} vCPU`
    /\$\{[^{}]*\}\s*GB/, // `${ramGb} GB`
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of banned) {
      assert.doesNotMatch(
        source,
        pattern,
        `${file} renders a Latin-digit spec — use specVcpuFa/specGbFa from lib/labels/customer`,
      );
    }
  }
});
