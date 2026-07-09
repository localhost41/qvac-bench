#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const requiredPublishedFiles = new Set([
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/reports/template.md",
  "docs/validation-checklist.md",
  packageJson.main,
  packageJson.types,
  ...binEntries.map(([, binPath]) => binPath)
]);

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

for (const requiredFile of requiredPublishedFiles) {
  if (!packedFiles.has(requiredFile)) {
    fail(`packed package is missing ${requiredFile}`);
  }
}

if (![...packedFiles].some((file) => file.endsWith(".d.ts"))) {
  fail("packed package does not include type declarations");
}

const installRootDir = mkdtempSync(join(tmpdir(), "qvac-bench-install-"));
const installCacheDir = mkdtempSync(join(tmpdir(), "qvac-bench-npm-install-cache-"));

try {
  const packResult = spawnSync("npm", ["pack", rootDir, "--json"], {
    cwd: installRootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: installCacheDir
    }
  });

  if (packResult.error) {
    fail(`npm pack could not start: ${packResult.error.message}`);
  }

  if (packResult.status !== 0) {
    fail(`npm pack exited with ${packResult.status}\n${packResult.stderr.trim()}`);
  }

  let packInstallOutput;
  try {
    packInstallOutput = JSON.parse(packResult.stdout);
  } catch {
    fail(`npm pack returned invalid JSON\n${packResult.stdout.trim()}`);
  }

  const tarballName = packInstallOutput[0]?.filename;
  if (typeof tarballName !== "string") {
    fail("npm pack did not report a tarball filename");
  }

  const tarballPath = join(installRootDir, tarballName);
  const installProjectDir = join(installRootDir, "consumer");
  mkdirSync(installProjectDir);
  writeFileSync(
    join(installProjectDir, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2)
  );

  const installResult = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: installProjectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: installCacheDir
    }
  });

  if (installResult.error) {
    fail(`npm install packed tarball could not start: ${installResult.error.message}`);
  }

  if (installResult.status !== 0) {
    fail(`npm install packed tarball exited with ${installResult.status}\n${installResult.stderr.trim()}`);
  }

  const importResult = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        `import { name, promptNames } from ${JSON.stringify(packageJson.name)};`,
        "if (name() !== 'qvac-bench') throw new Error('unexpected package name export');",
        "if (!promptNames().includes('hello')) throw new Error('missing prompt fixture export');"
      ].join("\n")
    ],
    {
      cwd: installProjectDir,
      encoding: "utf8"
    }
  );

  if (importResult.status !== 0) {
    fail(`installed package import smoke test failed\n${importResult.stderr.trim()}`);
  }

  const binResult = spawnSync("npx", ["--no-install", "qvac-bench", "--help"], {
    cwd: installProjectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: installCacheDir
    }
  });

  if (binResult.error) {
    fail(`installed package bin smoke test could not start: ${binResult.error.message}`);
  }

  if (binResult.status !== 0 || !binResult.stdout.includes("Usage: qvac-bench [options]")) {
    fail(`installed package bin smoke test failed\n${binResult.stderr.trim()}`);
  }

  for (const docsFile of ["docs/reports/template.md", "docs/validation-checklist.md"]) {
    if (!existsSync(join(installProjectDir, "node_modules", packageJson.name, docsFile))) {
      fail(`installed package is missing ${docsFile}`);
    }
  }

  console.log(`Package verification passed: ${packedPackage.filename}`);
} finally {
  rmSync(installRootDir, { recursive: true, force: true });
  rmSync(installCacheDir, { recursive: true, force: true });
}
