import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveAlias(specifier) {
  const subpath = specifier.slice(2);
  const candidates = [
    pathResolve(root, subpath),
    pathResolve(root, `${subpath}.ts`),
    pathResolve(root, subpath, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return pathToFileURL(pathResolve(root, subpath)).href;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(resolveAlias(specifier));
  }
  return nextResolve(specifier, context);
}
