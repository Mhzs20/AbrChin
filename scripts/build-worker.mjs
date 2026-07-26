import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "dist/worker/provisioning-worker.js");

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "scripts/provisioning-worker-entry.ts")],
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

console.log(`[build-worker] wrote ${outfile}`);
