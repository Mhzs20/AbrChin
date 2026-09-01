import { existsSync, statSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveAlias(specifier) {
  const subpath = specifier.slice(2);
  // Prefer concrete files. Bare directories are invalid ESM targets and must not
  // win over `index.ts` (e.g. `@/lib/sms` → `lib/sms/index.ts`).
  const candidates = [
    pathResolve(root, `${subpath}.ts`),
    pathResolve(root, subpath, "index.ts"),
    pathResolve(root, subpath),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      if (!statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    return pathToFileURL(candidate).href;
  }
  return pathToFileURL(pathResolve(root, `${subpath}.ts`)).href;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: pathToFileURL(pathResolve(root, "scripts/server-only-empty.mjs")).href,
    };
  }
  if (specifier.startsWith("@/")) {
    return nextResolve(resolveAlias(specifier));
  }
  return nextResolve(specifier, context);
}
