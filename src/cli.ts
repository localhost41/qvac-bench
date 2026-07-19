#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findPromptFixture, promptNames } from "./prompts.js";

export const helpText = `Usage: qvac-bench [options]

QVAC benchmark developer CLI.

Options:
  -h, --help              Show this help text
  --url <url>             QVAC OpenAI-compatible chat completions URL
                          Default: http://127.0.0.1:11434/v1/chat/completions
  --model <model>         Model name to request. Default: qvac
  --prompt <prompt>       Prompt to send. Default: Say hello in one short sentence.
  --prompt-name <name>    Built-in prompt fixture to run: ${promptNames().join(", ")}
  --max-tokens <tokens>   Maximum tokens to generate. Default: 64
  --iterations <count>    Number of repeated runs. Default: 1
  --timeout-ms <ms>       Request timeout in milliseconds. Default: 30000
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
  iterations?: number;
  timeoutMs: number;
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

export interface MetricSummary {
  min: number;
  median: number;
  max: number;
  p95: number;
}

export interface BenchmarkSummary {
  iterations: number;
  timeToFirstTokenMs: MetricSummary;
  totalTimeMs: MetricSummary;
  tokensPerSecond?: MetricSummary;
}

export interface RepeatedBenchmarkResult {
  iterations: number;
  results: BenchmarkResult[];
  summary: BenchmarkSummary;
}

export interface BenchmarkDependencies {
  fetch: typeof fetch;
  now: () => number;
}

const defaultOptions: BenchmarkOptions = {
  url: "http://127.0.0.1:11434/v1/chat/completions",
  model: "qvac",
  prompt: "Say hello in one short sentence.",
  maxTokens: 64,
  iterations: 1,
  timeoutMs: 30_000,
  outputFormat: "text"
};

type BenchmarkErrorCode = "server_unavailable" | "http_error" | "malformed_stream" | "timeout";

class BenchmarkError extends Error {
  constructor(
    readonly code: BenchmarkErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BenchmarkError";
  }
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    const hint =
      option === "--url" || option === "--model"
        ? `. Provide ${option} <${option === "--url" ? "url" : "model"}> or omit ${option} to use the default.`
        : "";
    throw new Error(`Missing value for ${option}${hint}`);
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
        if (!options.url.trim()) {
          throw new Error("Missing value for --url. Provide --url <url> or omit --url to use the default.");
        }
        index += 1;
        break;
      case "--model":
        options.model = readValue(args, index, arg);
        if (!options.model.trim()) {
          throw new Error("Missing value for --model. Provide --model <model> or omit --model to use the default.");
        }
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
      case "--iterations": {
        const rawValue = readValue(args, index, arg);
        const iterations = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(iterations) || iterations < 1) {
          throw new Error("--iterations must be a positive integer");
        }
        options.iterations = iterations;
        index += 1;
        break;
      }
      case "--timeout-ms": {
        const rawValue = readValue(args, index, arg);
        const timeoutMs = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
          throw new Error("--timeout-ms must be a positive integer");
        }
        options.timeoutMs = timeoutMs;
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
  try {
    return JSON.parse(data);
  } catch {
    throw new BenchmarkError("malformed_stream", "stream sent malformed JSON data");
  }
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

function summarizeNumbers(values: number[]): MetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;

  return {
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    p95: sorted[Math.max(0, Math.min(sorted.length - 1, p95Index))]
  };
}

function summarizeBenchmarkResults(results: BenchmarkResult[]): BenchmarkSummary {
  const tokensPerSecondValues = results
    .map((result) => result.tokensPerSecond)
    .filter((value): value is number => typeof value === "number");
  const summary: BenchmarkSummary = {
    iterations: results.length,
    timeToFirstTokenMs: summarizeNumbers(results.map((result) => result.timeToFirstTokenMs)),
    totalTimeMs: summarizeNumbers(results.map((result) => result.totalTimeMs))
  };

  if (tokensPerSecondValues.length > 0) {
    summary.tokensPerSecond = summarizeNumbers(tokensPerSecondValues);
  }

  return summary;
}

function formatMetricSummary(summary: MetricSummary, formatter: (value: number) => string): string {
  return [
    `min ${formatter(summary.min)}`,
    `median ${formatter(summary.median)}`,
    `max ${formatter(summary.max)}`,
    `p95 ${formatter(summary.p95)}`
  ].join(", ");
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

function formatRepeatedBenchmark(result: RepeatedBenchmarkResult): string {
  const lines = [
    `Iterations: ${result.iterations}`,
    `Time to first token summary: ${formatMetricSummary(result.summary.timeToFirstTokenMs, formatMilliseconds)}`,
    `Total generation time summary: ${formatMetricSummary(result.summary.totalTimeMs, formatMilliseconds)}`
  ];

  if (result.summary.tokensPerSecond) {
    lines.push(
      `Approx tokens/sec summary: ${formatMetricSummary(result.summary.tokensPerSecond, (value) =>
        value.toFixed(2)
      )}`
    );
  } else {
    lines.push("Approx tokens/sec summary: unavailable");
  }

  return `${lines.join("\n")}\n`;
}

function formatJsonBenchmark(result: BenchmarkResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatJsonRepeatedBenchmark(result: RepeatedBenchmarkResult): string {
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

function formatCsvRepeatedBenchmark(result: RepeatedBenchmarkResult): string {
  const columns = ["metric", "min", "median", "max", "p95"];
  const rows: Array<[string, MetricSummary]> = [
    ["timeToFirstTokenMs", result.summary.timeToFirstTokenMs],
    ["totalTimeMs", result.summary.totalTimeMs]
  ];
  if (result.summary.tokensPerSecond) {
    rows.push(["tokensPerSecond", result.summary.tokensPerSecond]);
  }

  return `${columns.join(",")}\n${rows
    .map(([metric, summary]) =>
      [
        formatCsvValue(metric),
        formatCsvValue(summary.min),
        formatCsvValue(summary.median),
        formatCsvValue(summary.max),
        formatCsvValue(summary.p95)
      ].join(",")
    )
    .join("\n")}\n`;
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

function formatRepeatedBenchmarkOutput(result: RepeatedBenchmarkResult, outputFormat: OutputFormat): string {
  switch (outputFormat) {
    case "json":
      return formatJsonRepeatedBenchmark(result);
    case "csv":
      return formatCsvRepeatedBenchmark(result);
    case "text":
      return formatRepeatedBenchmark(result);
  }
}

function safeEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = parsed.username ? "<redacted>" : "";
    parsed.password = parsed.password ? "<redacted>" : "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(api[-_]?key|authorization|auth|bearer|password|secret|token)/i.test(key)) {
        parsed.searchParams.set(key, "<redacted>");
      }
    }
    return parsed.toString().replaceAll("%3Credacted%3E", "<redacted>");
  } catch {
    return url.replace(/(api[-_]?key|authorization|auth|bearer|password|secret|token)=([^&\s]+)/gi, "$1=<redacted>");
  }
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1<redacted>@")
    .replace(/authorization:\s*bearer\s+[^\s,;]+/gi, "authorization: Bearer <redacted>")
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer <redacted>")
    .replace(/(api[-_]?key|authorization|auth|password|secret|token)=([^&\s]+)/gi, "$1=<redacted>");
}

function formatBenchmarkError(url: string, error: unknown): string {
  const endpoint = safeEndpointLabel(url);
  const reason = error instanceof Error ? ` ${sanitizeErrorMessage(error.message)}` : "";

  if (error instanceof BenchmarkError) {
    switch (error.code) {
      case "http_error":
        return `QVAC endpoint returned a non-2xx response at ${endpoint}.${reason}\n`;
      case "malformed_stream":
        return `QVAC endpoint returned a malformed stream at ${endpoint}.${reason}\n`;
      case "timeout":
        return `QVAC request timed out at ${endpoint}.${reason}\n`;
      case "server_unavailable":
        return `QVAC server unavailable at ${endpoint}. Is it running?${reason}\n`;
    }
  }

  return `QVAC server unavailable at ${endpoint}. Is it running?${reason}\n`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
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

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, options.timeoutMs);

  try {
    let response: Response;

    try {
      response = await dependencies.fetch(options.url, {
        method: "POST",
        headers,
        signal: abortController.signal,
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: "user", content: options.prompt }],
          max_tokens: options.maxTokens,
          stream: true,
          stream_options: { include_usage: true }
        })
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new BenchmarkError("timeout", `No response within ${options.timeoutMs} ms.`);
      }
      throw new BenchmarkError(
        "server_unavailable",
        error instanceof Error ? error.message : "Request failed before receiving a response."
      );
    }

    if (!response.ok) {
      throw new BenchmarkError("http_error", `HTTP ${response.status} ${response.statusText}`.trim());
    }
    if (!response.body) {
      throw new BenchmarkError("malformed_stream", "response did not include a stream body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let firstTokenTime: number | undefined;
    let completionTokens: number | undefined;

    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (error) {
        if (isAbortError(error)) {
          throw new BenchmarkError("timeout", `Stream did not finish within ${options.timeoutMs} ms.`);
        }
        throw new BenchmarkError(
          "malformed_stream",
          error instanceof Error ? error.message : "stream read failed"
        );
      }
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
      typeof completionTokens === "number" && generationSeconds > 0
        ? completionTokens / generationSeconds
        : undefined;

    return {
      timeToFirstTokenMs,
      totalTimeMs,
      completionTokens,
      tokensPerSecond,
      output
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function measureRepeatedQvacLatency(
  options: BenchmarkOptions,
  dependencies: BenchmarkDependencies = { fetch: globalThis.fetch, now: () => performance.now() }
): Promise<RepeatedBenchmarkResult> {
  const results: BenchmarkResult[] = [];
  const iterations = options.iterations ?? 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    results.push(await measureQvacLatency(options, dependencies));
  }

  return {
    iterations,
    results,
    summary: summarizeBenchmarkResults(results)
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
    if (options.iterations === 1) {
      const result = await measureQvacLatency(options, dependencies);
      return {
        stdout: formatBenchmarkOutput(result, options.outputFormat),
        stderr: "",
        exitCode: 0
      };
    }

    const result = await measureRepeatedQvacLatency(options, dependencies);
    return {
      stdout: formatRepeatedBenchmarkOutput(result, options.outputFormat),
      stderr: "",
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: formatBenchmarkError(options.url, error),
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
