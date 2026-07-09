#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function fail(message) {
  console.error(`Package verification failed: ${message}`);
  process.exit(1);
}

const binEntries =
  typeof packageJson.bin === "string"
    ? [[packageJson.name, packageJson.bin]]
    : Object.entries(packageJson.bin ?? {});

for (const [name, binPath] of binEntries) {
  if (!existsSync(join(rootDir, binPath))) {
    fail(`bin "${name}" points to missing built file: ${binPath}`);
  }
}

const npmCacheDir = mkdtempSync(join(tmpdir(), "qvac-bench-npm-cache-"));
let packResult;

try {
  packResult = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir
    }
  });
} finally {
  rmSync(npmCacheDir, { recursive: true, force: true });
}

if (packResult.error) {
  fail(`npm pack dry-run could not start: ${packResult.error.message}`);
}

if (packResult.status !== 0) {
  fail(`npm pack dry-run exited with ${packResult.status}\n${packResult.stderr.trim()}`);
}

let packOutput;
try {
  packOutput = JSON.parse(packResult.stdout);
} catch {
  fail(`npm pack dry-run returned invalid JSON\n${packResult.stdout.trim()}`);
}

const packedPackage = packOutput[0];
const packedFiles = new Set((packedPackage?.files ?? []).map((file) => file.path));
const requiredFiles = new Set([
  "README.md",
  "CHANGELOG.md",
  packageJson.main,
  packageJson.types,
  ...binEntries.map(([, binPath]) => binPath)
]);

for (const requiredFile of requiredFiles) {
  if (!packedFiles.has(requiredFile)) {
    fail(`packed package is missing ${requiredFile}`);
  }
}

if (![...packedFiles].some((file) => file.endsWith(".d.ts"))) {
  fail("packed package does not include type declarations");
}

console.log(`Package verification passed: ${packedPackage.filename}`);
