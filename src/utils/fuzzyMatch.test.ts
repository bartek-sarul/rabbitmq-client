import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzyMatch";

describe("fuzzyMatch", () => {
  it("should match when query is empty", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("should match a substring at the start, middle, or end", () => {
    expect(fuzzyMatch("prd", "prd")).toBe(true);
    expect(fuzzyMatch("prd", "prd-qwe")).toBe(true);
    expect(fuzzyMatch("prd", "qwe-prd")).toBe(true);
    expect(fuzzyMatch("prd", "asd-prd-asd")).toBe(true);
  });

  it("should match non-contiguous characters in order", () => {
    expect(fuzzyMatch("prd", "p-r-d")).toBe(true);
    expect(fuzzyMatch("prd", "production")).toBe(true);
  });

  it("should be case-insensitive", () => {
    expect(fuzzyMatch("PRD", "qwe-prd")).toBe(true);
    expect(fuzzyMatch("prd", "QWE-PRD")).toBe(true);
  });

  it("should not match when characters are out of order or missing", () => {
    expect(fuzzyMatch("prd", "drp")).toBe(false);
    expect(fuzzyMatch("prd", "pr")).toBe(false);
    expect(fuzzyMatch("prd", "")).toBe(false);
  });
});
