#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findPromptFixture, promptNames } from "./prompts.js";

export const helpText = `Usage: qvac-bench [options]

QVAC benchmark developer CLI.

Options:
  -h, --help              Show this help text
  --url <url>             QVAC OpenAI-compatible chat completions URL
                          Default: http://localhost:8000/v1/chat/completions
  --model <model>         Model name to request. Default: qvac
  --prompt <prompt>       Prompt to send. Default: Say hello in one short sentence.
  --prompt-name <name>    Built-in prompt fixture to run: ${promptNames().join(", ")}
  --max-tokens <tokens>   Maximum tokens to generate. Default: 64
  --output <format>       Output format: text, json, or csv. Default: text
  --api-key <key>         Optional bearer token. Defaults to QVAC_API_KEY or OPENAI_API_KEY
`;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type OutputFormat = "text" | "json" | "csv";

export interface BenchmarkOptions {
  url: string;
  model: string;
  prompt: string;
  maxTokens: number;
  outputFormat: OutputFormat;
  apiKey?: string;
}

export interface BenchmarkResult {
  timeToFirstTokenMs: number;
  totalTimeMs: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  output: string;
}

export interface BenchmarkDependencies {
  fetch: typeof fetch;
  now: () => number;
}

const defaultOptions: BenchmarkOptions = {
  url: "http://localhost:8000/v1/chat/completions",
  model: "qvac",
  prompt: "Say hello in one short sentence.",
  maxTokens: 64,
  outputFormat: "text"
};

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "csv") {
    return value;
  }
  throw new Error("--output must be one of: text, json, csv");
}

function parseArgs(args: string[], env: NodeJS.ProcessEnv): BenchmarkOptions {
  const options: BenchmarkOptions = {
    ...defaultOptions,
    apiKey: env.QVAC_API_KEY ?? env.OPENAI_API_KEY
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--url":
        options.url = readValue(args, index, arg);
        index += 1;
        break;
      case "--model":
        options.model = readValue(args, index, arg);
        index += 1;
        break;
      case "--prompt":
        options.prompt = readValue(args, index, arg);
        index += 1;
        break;
      case "--prompt-name": {
        const promptName = readValue(args, index, arg);
        const fixture = findPromptFixture(promptName);
        if (!fixture) {
          throw new Error(`Unknown prompt fixture: ${promptName}. Available fixtures: ${promptNames().join(", ")}`);
        }
        options.prompt = fixture.prompt;
        index += 1;
        break;
      }
      case "--max-tokens": {
        const rawValue = readValue(args, index, arg);
        const maxTokens = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(maxTokens) || maxTokens < 1) {
          throw new Error("--max-tokens must be a positive integer");
        }
        options.maxTokens = maxTokens;
        index += 1;
        break;
      }
      case "--output":
        options.outputFormat = parseOutputFormat(readValue(args, index, arg));
        index += 1;
        break;
      case "--api-key":
        options.apiKey = readValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseStreamData(line: string): unknown {
  const data = line.slice("data:".length).trim();
  if (!data || data === "[DONE]") {
    return undefined;
  }
  return JSON.parse(data);
}

function readTokenDelta(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") {
        return "";
      }
      const delta = (choice as { delta?: { content?: unknown }; text?: unknown }).delta;
      if (delta && typeof delta.content === "string") {
        return delta.content;
      }
      const text = (choice as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function readCompletionTokens(value: unknown): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = (value as { usage?: { completion_tokens?: unknown } }).usage;
  return typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatBenchmark(result: BenchmarkResult): string {
  const lines = [
    `Time to first token: ${formatMilliseconds(result.timeToFirstTokenMs)}`,
    `Total generation time: ${formatMilliseconds(result.totalTimeMs)}`
  ];

  if (typeof result.completionTokens === "number" && typeof result.tokensPerSecond === "number") {
    lines.push(`Completion tokens: ${result.completionTokens}`);
    lines.push(`Approx tokens/sec: ${result.tokensPerSecond.toFixed(2)}`);
  } else {
    lines.push("Completion tokens: unavailable");
    lines.push("Approx tokens/sec: unavailable");
  }

  lines.push(`Output: ${result.output || "(empty)"}`);

  return `${lines.join("\n")}\n`;
}

function formatJsonBenchmark(result: BenchmarkResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatCsvValue(value: string | number | undefined): string {
  if (typeof value === "undefined") {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatCsvBenchmark(result: BenchmarkResult): string {
  const columns: (keyof BenchmarkResult)[] = [
    "timeToFirstTokenMs",
    "totalTimeMs",
    "completionTokens",
    "tokensPerSecond",
    "output"
  ];
  const values = columns.map((column) => formatCsvValue(result[column]));
  return `${columns.join(",")}\n${values.join(",")}\n`;
}

function formatBenchmarkOutput(result: BenchmarkResult, outputFormat: OutputFormat): string {
  switch (outputFormat) {
    case "json":
      return formatJsonBenchmark(result);
    case "csv":
      return formatCsvBenchmark(result);
    case "text":
      return formatBenchmark(result);
  }
}

function formatUnavailableError(url: string, error: unknown): string {
  const reason = error instanceof Error ? ` ${error.message}` : "";
  return `QVAC server unavailable at ${url}. Is it running?${reason}\n`;
}

export async function measureQvacLatency(
  options: BenchmarkOptions,
  dependencies: BenchmarkDependencies = { fetch: globalThis.fetch, now: () => performance.now() }
): Promise<BenchmarkResult> {
  const startTime = dependencies.now();
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const response = await dependencies.fetch(options.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  if (!response.body) {
    throw new Error("response did not include a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let firstTokenTime: number | undefined;
  let completionTokens: number | undefined;

  while (true) {
    const readResult = await reader.read();
    if (readResult.done) {
      break;
    }

    buffer += decoder.decode(readResult.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const event = parseStreamData(line);
      if (!event) {
        continue;
      }

      completionTokens = readCompletionTokens(event) ?? completionTokens;
      const tokenDelta = readTokenDelta(event);
      if (tokenDelta) {
        firstTokenTime ??= dependencies.now();
        output += tokenDelta;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.startsWith("data:")) {
    const event = parseStreamData(buffer);
    completionTokens = readCompletionTokens(event) ?? completionTokens;
    const tokenDelta = readTokenDelta(event);
    if (tokenDelta) {
      firstTokenTime ??= dependencies.now();
      output += tokenDelta;
    }
  }

  const totalTimeMs = dependencies.now() - startTime;
  const timeToFirstTokenMs = (firstTokenTime ?? dependencies.now()) - startTime;
  const generationSeconds = totalTimeMs / 1000;
  const tokensPerSecond =
    typeof completionTokens === "number" && generationSeconds > 0 ? completionTokens / generationSeconds : undefined;

  return {
    timeToFirstTokenMs,
    totalTimeMs,
    completionTokens,
    tokensPerSecond,
    output
  };
}

export async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  dependencies?: BenchmarkDependencies
): Promise<CliResult> {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      stdout: helpText,
      stderr: "",
      exitCode: 0
    };
  }

  let options: BenchmarkOptions;
  try {
    options = parseArgs(args, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid arguments";
    return {
      stdout: "",
      stderr: `${message}\n\n${helpText}`,
      exitCode: 1
    };
  }

  try {
    const result = await measureQvacLatency(options, dependencies);
    return {
      stdout: formatBenchmarkOutput(result, options.outputFormat),
      stderr: "",
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: formatUnavailableError(options.url, error),
      exitCode: 1
    };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
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
  void main();
}
