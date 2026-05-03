import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatPathBasename,
  formatPercent,
  formatTokens,
  sanitizeStatusText,
} from "../../../extensions/little-footer/format.ts";

describe("formatTokens", () => {
  it("returns 0 for zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns raw integer below 1000", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("formats 1234 as 1.2k", () => {
    expect(formatTokens(1234)).toBe("1.2k");
  });

  it("formats 12345 as 12.3k", () => {
    expect(formatTokens(12_345)).toBe("12.3k");
  });

  it("formats 1_234_567 as 1.2M", () => {
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });

  it("formats 999_999 as 1000k (no decimal)", () => {
    expect(formatTokens(999_999)).toBe("1000k");
  });

  it("formats 10_456_789 as 10.5M", () => {
    expect(formatTokens(10_456_789)).toBe("10.5M");
  });
});

describe("formatCost", () => {
  it("returns $0 for zero", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("uses four decimals below 0.01", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("uses three decimals below 1", () => {
    expect(formatCost(0.1234)).toBe("$0.123");
  });

  it("uses two decimals at or above 1", () => {
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("formats sub-penny with four decimals", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
  });
});

describe("formatPercent", () => {
  it("returns ? for null", () => {
    expect(formatPercent(null)).toBe("?");
  });

  it("formats non-null with one decimal and percent sign", () => {
    expect(formatPercent(25)).toBe("25.0%");
  });

  it("formats 99.9 correctly", () => {
    expect(formatPercent(99.9)).toBe("99.9%");
  });
});

describe("formatPathBasename", () => {
  it("extracts basename from Unix path", () => {
    expect(formatPathBasename("/Users/me/repo")).toBe("repo");
  });

  it("handles trailing slash", () => {
    expect(formatPathBasename("/Users/me/repo/")).toBe("repo");
  });

  it("handles Windows paths", () => {
    expect(formatPathBasename("C:\\Users\\me\\repo")).toBe("repo");
  });

  it("returns / for empty root", () => {
    expect(formatPathBasename("/")).toBe("/");
  });

  it("handles single segment", () => {
    expect(formatPathBasename("repo")).toBe("repo");
  });
});

describe("sanitizeStatusText", () => {
  it("replaces newlines, tabs, and carriage returns with spaces", () => {
    expect(sanitizeStatusText("a\nb\t c")).toBe("a b c");
  });

  it("collapses repeated spaces", () => {
    expect(sanitizeStatusText("a   b")).toBe("a b");
  });

  it("trims whitespace", () => {
    expect(sanitizeStatusText("  hello  ")).toBe("hello");
  });

  it("handles mixed control characters", () => {
    expect(sanitizeStatusText("line1\r\nline2\t\tspace")).toBe(
      "line1 line2 space",
    );
  });
});
