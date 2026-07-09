import { describe, expect, it } from "vitest";
import { helpText, runCli } from "../src/cli.js";
import { name } from "../src/index.js";

describe("qvac-bench", () => {
  it("exports the package name", () => {
    expect(name()).toBe("qvac-bench");
  });

  it("shows CLI help text", () => {
    expect(helpText).toContain("Usage: qvac-bench [options]");
    expect(helpText).toContain("--help");
  });

  it("runs the CLI help command", () => {
    expect(runCli(["--help"])).toEqual({
      stdout: helpText,
      stderr: "",
      exitCode: 0
    });
  });

  it("reports unknown CLI options", () => {
    const result = runCli(["--unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown option: --unknown");
    expect(result.stderr).toContain("Usage: qvac-bench [options]");
  });
});
