#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const helpText = `Usage: qvac-bench [options]

QVAC benchmark developer CLI.

Options:
  -h, --help    Show this help text
`;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(args: string[]): CliResult {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return {
      stdout: helpText,
      stderr: "",
      exitCode: 0
    };
  }

  return {
    stdout: "",
    stderr: `Unknown option: ${args[0]}\n\n${helpText}`,
    exitCode: 1
  };
}

function main(): void {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

const currentFile = realpathSync(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : "";

if (invokedFile === currentFile) {
  main();
}
