import { afterEach, describe, expect, it, vi } from "vitest";
import { helpText, measureQvacLatency, runCli } from "../src/cli.js";
import { name } from "../src/index.js";

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the package name", () => {
    expect(name()).toBe("qvac-bench");
  });

  it("shows CLI help text", () => {
    expect(helpText).toContain("Usage: qvac-bench [options]");
    expect(helpText).toContain("--help");
    expect(helpText).toContain("--output");
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
});
