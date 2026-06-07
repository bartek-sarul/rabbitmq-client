import { describe, it, expect } from "vitest";
import { sanitizeQuotes } from "./sanitize";

describe("sanitizeQuotes", () => {
  it("should return empty string when input is empty", () => {
    expect(sanitizeQuotes("")).toBe("");
  });

  it("should not modify normal straight quotes", () => {
    expect(sanitizeQuotes(`hello "world" and 'friend'`)).toBe(`hello "world" and 'friend'`);
  });

  it("should replace smart double quotes with standard double quotes", () => {
    // Left and right double quotes: \u201C and \u201D
    expect(sanitizeQuotes("“hello”")).toBe('"hello"');
    // High-reversed-9 double quote: \u201F
    expect(sanitizeQuotes("‟hello‟")).toBe('"hello"');
    // Double prime: \u2033
    expect(sanitizeQuotes("hello″")).toBe('hello"');
    // Reversed double prime: \u2036
    expect(sanitizeQuotes("hello‟")).toBe('hello"');
  });

  it("should replace smart single quotes with standard single quotes", () => {
    // Left and right single quotes: \u2018 and \u2019
    expect(sanitizeQuotes("‘hello’")).toBe("'hello'");
    // High-reversed-9 single quote: \u201B
    expect(sanitizeQuotes("‛hello‛")).toBe("'hello'");
    // Prime: \u2032
    expect(sanitizeQuotes("hello′")).toBe("hello'");
    // Reversed prime: \u2035
    expect(sanitizeQuotes("hello‛")).toBe("hello'");
  });

  it("should sanitize mixed text correctly", () => {
    const input = `{"key": “value”, ‘option’: ‘yes’}`;
    const expected = `{"key": "value", 'option': 'yes'}`;
    expect(sanitizeQuotes(input)).toBe(expected);
  });
});
