import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { helpText, measureQvacLatency, runCli } from "../src/cli.js";
import { name } from "../src/index.js";
import { findPromptFixture, promptFixtures, promptNames } from "../src/prompts.js";
import { createServer } from "http";
import type { AddressInfo } from "net";

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

describe("qvac-bench", () => {
  let mockServer: ReturnType<typeof createServer>;
  let mockPort = 0;
  let mockBaseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer = createServer((_req, res) => {
        if (_req.url === "/v1/chat/completions" && _req.method === "POST") {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[],"usage":{"completion_tokens":2}}\n\n',
            "data: [DONE]\n\n"
          ];

          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          });

          for (const chunk of chunks) {
            res.write(chunk);
          }

          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });

      mockServer.listen(0, () => {
        const addr = mockServer.address() as AddressInfo;
        mockPort = addr.port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await new Promise<void>((resolve, reject) => {
        mockServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

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
    expect(JSON.parse(result.stdout)).toEqual({
      timeToFirstTokenMs: 125,
      totalTimeMs: 500,
      completionTokens: 4,
      tokensPerSecond: 8,
      output: "Hello"
    });
  });

  it("outputs benchmark results as CSV", async () => {
    const result = await runCli(["--output", "csv"], {}, benchmarkDependenciesForOutput('Hello, "qvac"'));

    expect(result).toEqual({
      stdout:
        'timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output\n125,500,4,8,"Hello, ""qvac"""\n',
      stderr: "",
      exitCode: 0
    });
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

  it("smoke-tests the CLI against a mock streaming endpoint", async () => {
    const result = await runCli([
      "--url", `${mockBaseUrl}/v1/chat/completions`,
      "--output", "json",
      "--prompt", "test"
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("timeToFirstTokenMs");
    expect(parsed).toHaveProperty("totalTimeMs");
    expect(parsed).toHaveProperty("completionTokens");
    expect(parsed).toHaveProperty("tokensPerSecond");
    expect(parsed.output).toBeTruthy();

    expect(parsed.timeToFirstTokenMs).toBeGreaterThan(0);
    expect(parsed.totalTimeMs).toBeGreaterThan(0);
    expect(parsed.totalTimeMs).toBeGreaterThanOrEqual(parsed.timeToFirstTokenMs);
    expect(parsed.completionTokens).toBeGreaterThanOrEqual(1);
    expect(parsed.tokensPerSecond).toBeGreaterThan(0);
  });
});
