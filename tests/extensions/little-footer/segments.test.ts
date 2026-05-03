import { describe, expect, it } from "vitest";
import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import { iconsFor } from "../../../extensions/little-footer/icons.ts";
import {
  renderCost,
  renderExtensionStatus,
  renderGit,
  renderModel,
  renderPath,
  renderQuota,
  renderThinking,
  renderTokens,
  type ThemeFn,
} from "../../../extensions/little-footer/segments.ts";

const fakeTheme: ThemeFn = {
  fg: (role: ThemeColor, text: string) => `<${role}>${text}</${role}>`,
};

const icons = iconsFor(false);

describe("renderModel", () => {
  it("returns null with undefined modelId", () => {
    expect(renderModel(fakeTheme, undefined)).toBeNull();
  });

  it("returns null with empty modelId", () => {
    expect(renderModel(fakeTheme, "")).toBeNull();
  });

  it("includes provider display and model leaf", () => {
    const result = renderModel(fakeTheme, "anthropic/claude-sonnet-4-6");
    expect(result).toContain("<text>Anthropic: Claude Sonnet 4 6</text>");
  });

  it("renders without provider when no slash", () => {
    const result = renderModel(fakeTheme, "claude-3-opus");
    expect(result).toContain("<text>Claude 3 Opus</text>");
  });
});

describe("renderThinking", () => {
  it("returns null with undefined level", () => {
    expect(renderThinking(fakeTheme, icons, undefined)).toBeNull();
  });

  it("returns null with empty level", () => {
    expect(renderThinking(fakeTheme, icons, "")).toBeNull();
  });

  it("maps off to 'off' label", () => {
    const result = renderThinking(fakeTheme, icons, "off");
    expect(result).toContain("<dim>");
    expect(result).toContain("off");
  });

  it("maps minimal to 'min'", () => {
    const result = renderThinking(fakeTheme, icons, "minimal");
    expect(result).toContain("<muted>");
    expect(result).toContain("min");
  });

  it("maps low to 'low'", () => {
    const result = renderThinking(fakeTheme, icons, "low");
    expect(result).toContain("<accent>");
    expect(result).toContain("low");
  });

  it("maps medium to 'med'", () => {
    const result = renderThinking(fakeTheme, icons, "medium");
    expect(result).toContain("<accent>");
    expect(result).toContain("med");
  });

  it("maps high to 'high' with warning", () => {
    const result = renderThinking(fakeTheme, icons, "high");
    expect(result).toContain("<warning>");
    expect(result).toContain("high");
  });

  it("maps xhigh to 'xhi' with error", () => {
    const result = renderThinking(fakeTheme, icons, "xhigh");
    expect(result).toContain("<error>");
    expect(result).toContain("xhi");
  });

  it("falls back for unknown level", () => {
    const result = renderThinking(fakeTheme, icons, "foobar");
    expect(result).toContain("<dim>");
    expect(result).toContain("foobar");
  });
});

describe("renderPath", () => {
  it("shows cwd basename", () => {
    const result = renderPath(fakeTheme, icons, "/Users/me/repo");
    expect(result).toContain("<text>repo</text>");
  });

  it("handles trailing slash", () => {
    const result = renderPath(fakeTheme, icons, "/Users/me/repo/");
    expect(result).toContain("<text>repo</text>");
  });
});

describe("renderGit", () => {
  it("returns null without branch", () => {
    expect(renderGit(fakeTheme, icons, null)).toBeNull();
  });

  it("returns null with empty string", () => {
    expect(renderGit(fakeTheme, icons, "")).toBeNull();
  });

  it("renders branch with success color", () => {
    const result = renderGit(fakeTheme, icons, "main");
    expect(result).toContain("<success>main</success>");
  });

  it("trims branch names to 15 characters", () => {
    const result = renderGit(fakeTheme, icons, "feature/very-long-branch-name");
    expect(result).toContain("<success>feature/very");
    expect(result).toContain("...");
    expect(result).not.toContain("feature/very-long-branch-name");
  });

  it("renders without dirty indicator when not dirty", () => {
    const result = renderGit(fakeTheme, icons, "main", false);
    expect(result).not.toContain("●");
    expect(result).not.toContain("*");
  });

  it("renders dirty indicator when dirty (ascii)", () => {
    const result = renderGit(fakeTheme, icons, "main", true);
    expect(result).toContain("<error>*</error>");
    expect(result).not.toContain("●");
  });

  it("renders dirty indicator when dirty (nerd)", () => {
    const nerdIcons = iconsFor(true);
    const result = renderGit(fakeTheme, nerdIcons, "main", true);
    expect(result).toContain("<error>!</error>");
  });

  it("renders diff counts when dirty", () => {
    const result = renderGit(fakeTheme, icons, "main", true, {
      added: 12,
      deleted: 3,
    });
    expect(result).toContain("<success>+12</success>");
    expect(result).toContain("<error>-3</error>");
    expect(result).not.toContain("<error>*</error>");
  });

  it("falls back to dirty marker when diff counts are absent", () => {
    const result = renderGit(fakeTheme, icons, "main", true, null);
    expect(result).toContain("<error>*</error>");
  });
});

describe("renderTokens", () => {
  it("returns null for zero tokens", () => {
    expect(renderTokens(fakeTheme, icons, 0)).toBeNull();
  });

  it("renders token count for non-zero", () => {
    const result = renderTokens(fakeTheme, icons, 1234);
    expect(result).toContain("<text>");
    expect(result).toContain("1.2k");
  });
});

describe("renderCost", () => {
  it("returns null for zero cost", () => {
    expect(renderCost(fakeTheme, icons, 0)).toBeNull();
  });

  it("renders sub-dollar cost", () => {
    const result = renderCost(fakeTheme, icons, 0.1234);
    expect(result).toContain("<text>");
    expect(result).toContain("$0.123");
  });

  it("renders dollar-plus cost", () => {
    const result = renderCost(fakeTheme, icons, 1.50);
    expect(result).toContain("<text>");
    expect(result).toContain("$1.50");
  });
});

describe("renderQuota", () => {
  it("returns null with null input", () => {
    expect(renderQuota(fakeTheme, icons, null)).toBeNull();
  });

  it("returns null with no windows", () => {
    expect(
      renderQuota(fakeTheme, icons, {
        limitId: "codex",
        limitName: "OpenAI",
        primary: null,
        secondary: null,
      }),
    ).toBeNull();
  });

  it("uses dim color below 70%", () => {
    const result = renderQuota(fakeTheme, icons, {
      limitId: "codex",
      limitName: "OpenAI",
      primary: {
        usedPercent: 69.9,
        windowDurationMins: 300,
        resetsAt: null,
      },
      secondary: null,
    });
    expect(result).toContain("<dim>");
    expect(result).toContain("OpenAI");
    expect(result).toContain("5h");
    expect(result).toContain("30.1%");
  });

  it("uses warning color at 70%", () => {
    const result = renderQuota(fakeTheme, icons, {
      limitId: "codex",
      limitName: "OpenAI",
      primary: {
        usedPercent: 70,
        windowDurationMins: 300,
        resetsAt: null,
      },
      secondary: null,
    });
    expect(result).toContain("<warning>");
    expect(result).toContain("OpenAI");
    expect(result).toContain("30%");
  });

  it("uses error color at 90%", () => {
    const result = renderQuota(fakeTheme, icons, {
      limitId: "codex",
      limitName: "OpenAI",
      primary: {
        usedPercent: 90,
        windowDurationMins: 10080,
        resetsAt: null,
      },
      secondary: null,
    });
    expect(result).toContain("<error>");
    expect(result).toContain("OpenAI");
    expect(result).toContain("1w");
    expect(result).toContain("10%");
  });

  it("renders both windows when available", () => {
    const result = renderQuota(fakeTheme, icons, {
      limitId: "codex",
      limitName: "OpenAI",
      primary: {
        usedPercent: 50,
        windowDurationMins: 300,
        resetsAt: null,
      },
      secondary: {
        usedPercent: 10,
        windowDurationMins: 10080,
        resetsAt: null,
      },
    });
    expect(result).toContain("OpenAI");
    expect(result).toContain("5h");
    expect(result).toContain("50%");
    expect(result).toContain("1w");
    expect(result).toContain("90%");
  });
});

describe("renderExtensionStatus", () => {
  it("uses muted color", () => {
    const result = renderExtensionStatus(fakeTheme, "building...");
    expect(result).toContain("<muted>");
  });

  it("sanitizes newlines", () => {
    const result = renderExtensionStatus(fakeTheme, "line1\nline2");
    expect(result).not.toContain("\n");
    expect(result).toContain("line1 line2");
  });

  it("sanitizes tabs", () => {
    const result = renderExtensionStatus(fakeTheme, "a\tb");
    expect(result).not.toContain("\t");
    expect(result).toContain("a b");
  });

  it("trims whitespace", () => {
    const result = renderExtensionStatus(fakeTheme, "  hello  ");
    expect(result).toContain("<muted>hello</muted>");
  });
});
