import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

register("./scripts/test-resolve-hook-handler.mjs", pathToFileURL(root + "/"));
