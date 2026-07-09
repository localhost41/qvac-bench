import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpText, measureQvacLatency, runCli } from "../src/cli.js";
import { name } from "../src/index.js";
import { findPromptFixture, promptFixtures, promptNames } from "../src/prompts.js";

const jsonResultRequiredKeys = ["timeToFirstTokenMs", "totalTimeMs", "output"] as const;
const jsonResultOptionalKeys = ["completionTokens", "tokensPerSecond"] as const;
const jsonResultAllowedKeys: string[] = [...jsonResultRequiredKeys, ...jsonResultOptionalKeys].sort();
const csvHeaderGolden = "timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output";

function expectJsonBenchmarkResultShape(value: unknown): asserts value is Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));

  const result = value as Record<string, unknown>;
  expect(Object.keys(result).sort().every((key) => jsonResultAllowedKeys.includes(key))).toBe(true);
  for (const key of jsonResultRequiredKeys) {
    expect(result).toHaveProperty(key);
  }
  expect(result.timeToFirstTokenMs).toEqual(expect.any(Number));
  expect(result.totalTimeMs).toEqual(expect.any(Number));
  if ("completionTokens" in result) {
    expect(result.completionTokens).toEqual(expect.any(Number));
  }
  if ("tokensPerSecond" in result) {
    expect(result.tokensPerSecond).toEqual(expect.any(Number));
  }
  expect(result.output).toEqual(expect.any(String));
}

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

function benchmarkDependenciesForOutput(output: string) {
  const fetchMock: typeof fetch = async () =>
    new Response(
      streamFrom([
        `data: {"choices":[{"delta":{"content":${JSON.stringify(output)}}}]}\n\n`,
        'data: {"choices":[],"usage":{"completion_tokens":4}}\n\n',
        "data: [DONE]\n\n"
      ]),
      { status: 200, statusText: "OK" }
    );
  const times = [0, 125, 500];

  return {
    fetch: fetchMock,
    now: () => times.shift() ?? 500
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isListenUnavailable(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

async function startMockStreamingServer(): Promise<{
  close: () => Promise<void>;
  requests: unknown[];
  url: string;
}> {
  const requests: unknown[] = [];
  const server: Server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });

      void (async () => {
        await delay(10);
        response.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
        await delay(10);
        response.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
        response.write('data: {"choices":[],"usage":{"completion_tokens":3}}\n\n');
        response.end("data: [DONE]\n\n");
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    requests,
    url: `http://127.0.0.1:${address.port}/v1/chat/completions`
  };
}

describe("qvac-bench", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the package name", () => {
    expect(name()).toBe("qvac-bench");
  });

  it("exports basic prompt fixtures", () => {
    expect(promptNames()).toEqual(["hello", "summary", "reasoning"]);
    expect(promptFixtures).toHaveLength(3);
    expect(findPromptFixture("summary")?.prompt).toContain("Summarize this");
  });

  it("shows CLI help text", () => {
    expect(helpText).toContain("Usage: qvac-bench [options]");
    expect(helpText).toContain("--help");
    expect(helpText).toContain("--output");
    expect(helpText).toContain("--prompt-name <name>");
    expect(helpText).toContain("hello, summary, reasoning");
  });

  it("runs the CLI help command", async () => {
    await expect(runCli(["--help"])).resolves.toEqual({
      stdout: helpText,
      stderr: "",
      exitCode: 0
    });
  });

  it("reports unknown CLI options", async () => {
    const result = await runCli(["--unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown option: --unknown");
    expect(result.stderr).toContain("Usage: qvac-bench [options]");
  });

  it("reports unsupported CLI output formats", async () => {
    const result = await runCli(["--output", "xml"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--output must be one of: text, json, csv");
    expect(result.stderr).toContain("Usage: qvac-bench [options]");
  });

  it("reports unknown named prompt fixtures", async () => {
    const result = await runCli(["--prompt-name", "missing"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown prompt fixture: missing");
    expect(result.stderr).toContain("Available fixtures: hello, summary, reasoning");
  });

  it("runs a named prompt fixture", async () => {
    let requestBody: unknown;
    const fetchMock: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
          'data: {"choices":[],"usage":{"completion_tokens":1}}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200, statusText: "OK" }
      );
    };
    const times = [0, 10, 20];

    const result = await runCli(
      ["--prompt-name", "reasoning"],
      {},
      {
        fetch: fetchMock,
        now: () => times.shift() ?? 20
      }
    );

    expect(result.exitCode).toBe(0);
    expect(requestBody).toMatchObject({
      messages: [{ role: "user", content: findPromptFixture("reasoning")?.prompt }]
    });
  });

  it("outputs benchmark results as JSON", async () => {
    const result = await runCli(["--output", "json"], {}, benchmarkDependenciesForOutput("Hello"));

    expect(result).toMatchObject({
      stderr: "",
      exitCode: 0
    });
    const output = JSON.parse(result.stdout) as unknown;

    expectJsonBenchmarkResultShape(output);
    expect(Object.keys(output).sort()).toEqual(jsonResultAllowedKeys);
    expect(output).toEqual({
      timeToFirstTokenMs: 125,
      totalTimeMs: 500,
      completionTokens: 4,
      tokensPerSecond: 8,
      output: "Hello"
    });
  });

  it("omits optional JSON usage fields when completion tokens are unavailable", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(streamFrom(['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', "data: [DONE]\n\n"]), {
        status: 200,
        statusText: "OK"
      });
    const times = [0, 125, 500];

    const result = await runCli(
      ["--output", "json"],
      {},
      {
        fetch: fetchMock,
        now: () => times.shift() ?? 500
      }
    );
    const output = JSON.parse(result.stdout) as unknown;

    expect(result).toMatchObject({
      stderr: "",
      exitCode: 0
    });
    expectJsonBenchmarkResultShape(output);
    expect(output).toEqual({
      timeToFirstTokenMs: 125,
      totalTimeMs: 500,
      output: "Hello"
    });
  });

  it("outputs benchmark results as CSV", async () => {
    const result = await runCli(["--output", "csv"], {}, benchmarkDependenciesForOutput('Hello, "qvac"'));

    const rows = result.stdout.trimEnd().split("\n");
    expect(result).toEqual({
      stdout:
        'timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output\n125,500,4,8,"Hello, ""qvac"""\n',
      stderr: "",
      exitCode: 0
    });
    expect(rows).toEqual([csvHeaderGolden, '125,500,4,8,"Hello, ""qvac"""']);
  });

  it("keeps CSV headers and row ordering stable when usage is unavailable", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(streamFrom(['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', "data: [DONE]\n\n"]), {
        status: 200,
        statusText: "OK"
      });
    const times = [0, 125, 500];

    const result = await runCli(
      ["--output", "csv"],
      {},
      {
        fetch: fetchMock,
        now: () => times.shift() ?? 500
      }
    );

    expect(result).toEqual({
      stdout: `${csvHeaderGolden}\n125,500,,,Hello\n`,
      stderr: "",
      exitCode: 0
    });
    expect(result.stdout.trimEnd().split("\n")).toEqual([csvHeaderGolden, "125,500,,,Hello"]);
  });

  it("smoke tests the CLI against a local mock streaming endpoint", async () => {
    let mockServer: Awaited<ReturnType<typeof startMockStreamingServer>>;
    try {
      mockServer = await startMockStreamingServer();
    } catch (error) {
      if (!process.env.CI && isListenUnavailable(error)) {
        return;
      }
      throw error;
    }

    try {
      const result = await runCli([
        "--url",
        mockServer.url,
        "--model",
        "qvac-mock",
        "--prompt",
        "hello",
        "--max-tokens",
        "8",
        "--output",
        "json"
      ]);

      expect(result).toMatchObject({
        stderr: "",
        exitCode: 0
      });
      expect(mockServer.requests).toEqual([
        {
          model: "qvac-mock",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 8,
          stream: true,
          stream_options: { include_usage: true }
        }
      ]);

      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(output.output).toBe("Hello");
      expect(output.completionTokens).toBe(3);
      expect(output.timeToFirstTokenMs).toEqual(expect.any(Number));
      expect(output.totalTimeMs).toEqual(expect.any(Number));
      expect(output.tokensPerSecond).toEqual(expect.any(Number));
      expect(output.timeToFirstTokenMs as number).toBeGreaterThanOrEqual(0);
      expect(output.totalTimeMs as number).toBeGreaterThanOrEqual(output.timeToFirstTokenMs as number);
      expect(output.tokensPerSecond as number).toBeGreaterThan(0);
      expect(Number.isFinite(output.tokensPerSecond as number)).toBe(true);
    } finally {
      await mockServer.close();
    }
  });

  it("measures first token time, total time, and tokens per second from a streaming response", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer test-key"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "qvac-local",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 8,
        stream: true,
        stream_options: { include_usage: true }
      });

      return new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[],"usage":{"completion_tokens":4}}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200, statusText: "OK" }
      );
    };
    const times = [0, 125, 500];

    const result = await measureQvacLatency(
      {
        url: "http://localhost:8000/v1/chat/completions",
        model: "qvac-local",
        prompt: "hello",
        maxTokens: 8,
        outputFormat: "text",
        apiKey: "test-key"
      },
      {
        fetch: fetchMock,
        now: () => times.shift() ?? 500
      }
    );

    expect(result).toEqual({
      timeToFirstTokenMs: 125,
      totalTimeMs: 500,
      completionTokens: 4,
      tokensPerSecond: 8,
      output: "Hello"
    });
  });

  it("reports unavailable QVAC server errors clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8000");
      })
    );

    const result = await runCli(["--url", "http://127.0.0.1:8000/v1/chat/completions"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("QVAC server unavailable at http://127.0.0.1:8000/v1/chat/completions.");
    expect(result.stderr).toContain("Is it running?");
    expect(result.stderr).toContain("ECONNREFUSED");
  });
});
