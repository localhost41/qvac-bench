import { afterEach, describe, expect, it, vi } from "vitest";
import { helpText, measureQvacLatency, runCli } from "../src/cli.js";
import { name } from "../src/index.js";
import { findPromptFixture, promptFixtures, promptNames } from "../src/prompts.js";

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

  // ------------------------------------------------------------
  // Schema / golden output tests for Issue #17
  // ------------------------------------------------------------

  it("validates JSON output keys and data types", async () => {
    const result = await runCli(["--output", "json"], {}, benchmarkDependenciesForOutput("Hello"));
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);

    // required fields
    expect(parsed).toHaveProperty("timeToFirstTokenMs");
    expect(typeof parsed.timeToFirstTokenMs).toBe("number");
    expect(parsed).toHaveProperty("totalTimeMs");
    expect(typeof parsed.totalTimeMs).toBe("number");
    expect(parsed).toHaveProperty("output");
    expect(typeof parsed.output).toBe("string");

    // optional fields present when usage data is available
    expect(parsed).toHaveProperty("completionTokens");
    expect(typeof parsed.completionTokens).toBe("number");
    expect(parsed).toHaveProperty("tokensPerSecond");
    expect(typeof parsed.tokensPerSecond).toBe("number");

    // no extra keys beyond the documented shape
    const keys = Object.keys(parsed);
    expect(keys).toHaveLength(5);
  });

  it("JSON output omits optional fields when usage data is missing", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200 }
      );
    const times = [0, 100, 300];

    const result = await runCli(
      ["--output", "json"],
      {},
      { fetch: fetchMock, now: () => times.shift() ?? 300 }
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);

    // required fields still present
    expect(parsed).toHaveProperty("timeToFirstTokenMs");
    expect(parsed).toHaveProperty("totalTimeMs");
    expect(parsed).toHaveProperty("output");

    // optional fields omitted
    expect(parsed).not.toHaveProperty("completionTokens");
    expect(parsed).not.toHaveProperty("tokensPerSecond");

    // only the three required keys
    const keys = Object.keys(parsed);
    expect(keys).toHaveLength(3);
  });

  it("CSV output always starts with the expected header columns", async () => {
    const result = await runCli(["--output", "csv"], {}, benchmarkDependenciesForOutput("Hello"));
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(2); // header + data row
    expect(lines[0]).toBe(
      "timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output"
    );
  });

  it("CSV row with deterministic data matches golden snapshot", async () => {
    // data that yields a round, integer tokensPerSecond value
    const fetchMock: typeof fetch = async () =>
      new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"completion_tokens":4}}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200 }
      );
    const times = [0, 200, 500]; // first token at 200 ms, total 500 ms → 8 tokens/sec

    const result = await runCli(
      ["--output", "csv"],
      {},
      { fetch: fetchMock, now: () => times.shift() ?? 500 }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output
      200,500,4,8,Hi
      "
    `);
  });

  it("CSV output renders empty optional fields when usage data is missing", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"X"}}]}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200 }
      );
    const times = [0, 100, 300];

    const result = await runCli(
      ["--output", "csv"],
      {},
      { fetch: fetchMock, now: () => times.shift() ?? 300 }
    );

    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe(
      "timeToFirstTokenMs,totalTimeMs,completionTokens,tokensPerSecond,output"
    );

    const data = lines[1].split(",");
    expect(data[0]).toBe("100");
    expect(data[1]).toBe("300");
    expect(data[2]).toBe(""); // no completion tokens
    expect(data[3]).toBe(""); // no tokens per second
    expect(data[4]).toBe("X"); // raw content
  });
});
