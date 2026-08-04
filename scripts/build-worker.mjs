import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  {
    entry: "scripts/provisioning-worker-entry.ts",
    outfile: "dist/worker/provisioning-worker.js",
    label: "worker",
  },
  {
    entry: "scripts/catalog-sync-entry.ts",
    outfile: "dist/catalog-sync/catalog-sync.js",
    label: "catalog-sync",
  },
  {
    entry: "scripts/catalog-sync-scheduler-entry.ts",
    outfile: "dist/catalog-sync/catalog-sync-scheduler.js",
    label: "catalog-sync-scheduler",
  },
];

for (const target of targets) {
  const outfile = resolve(root, target.outfile);
  mkdirSync(dirname(outfile), { recursive: true });

  await esbuild.build({
    entryPoints: [resolve(root, target.entry)],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    alias: {
      "@": root,
    },
    packages: "external",
    sourcemap: true,
    logLevel: "info",
  });

  console.log(`[build-runtime] wrote ${target.label}: ${outfile}`);
}
