import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Scan both tracked files and untracked release-candidate files. A dirty
// worktree must not create a blind spot before its first commit.
const files = execFileSync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/,
  /\bgh[pousr]_[0-9A-Za-z]{30,}\b/,
];
const findings: string[] = [];

for (const file of files) {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(content))) {
    findings.push(file);
  }
}

if (findings.length > 0) {
  throw new Error(`possible secret material in tracked files: ${findings.join(", ")}`);
}
try {
  const workflows = execFileSync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".github/workflows",
  ])
    .toString("utf8")
    .trim();
  if (workflows) throw new Error(".github/workflows must remain absent");
} catch (error) {
  if (error instanceof Error && error.message.includes("must remain absent")) {
    throw error;
  }
}

console.log("[secret-scan] no high-confidence secret material or GitHub workflows found");
