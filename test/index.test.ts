import { describe, expect, it } from "vitest";
import { name } from "../src/index.js";

describe("qvac-bench", () => {
  it("exports the package name", () => {
    expect(name()).toBe("qvac-bench");
  });
});
