import { describe, expect, it } from "vitest";
import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import { iconsFor } from "./icons.ts";
import {
  renderContext,
  renderCost,
  renderExtensionStatus,
  renderGit,
  renderModel,
  renderPath,
  renderPi,
  renderThinking,
  renderTokens,
  type ThemeFn,
} from "./segments.ts";

const fakeTheme: ThemeFn = {
  fg: (role: ThemeColor, text: string) => `<${role}>${text}</${role}>`,
};

const icons = iconsFor(false);

describe("renderPi", () => {
  it("uses accent color", () => {
    const result = renderPi(fakeTheme, icons);
    expect(result).toContain("<accent>");
    expect(result).toContain("</accent>");
  });

  it("renders the pi icon", () => {
    const result = renderPi(fakeTheme, icons);
    expect(result).toContain("π");
  });
});

describe("renderModel", () => {
  it("returns null with undefined modelId", () => {
    expect(renderModel(fakeTheme, icons, undefined)).toBeNull();
  });

  it("returns null with empty modelId", () => {
    expect(renderModel(fakeTheme, icons, "")).toBeNull();
  });

  it("includes provider display and model leaf", () => {
    const result = renderModel(fakeTheme, icons, "anthropic/claude-sonnet-4-6");
    expect(result).toContain("<text>Anthropic: Claude Sonnet 4 6</text>");
  });

  it("renders without provider when no slash", () => {
    const result = renderModel(fakeTheme, icons, "claude-3-opus");
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
    expect(result).toContain("<error>●</error>");
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

describe("renderContext", () => {
  it("returns null with null input", () => {
    expect(renderContext(fakeTheme, icons, null)).toBeNull();
  });

  it("returns null with null percent", () => {
    expect(
      renderContext(fakeTheme, icons, { percent: null, contextWindow: 200_000 }),
    ).toBeNull();
  });

  it("uses dim color below 70%", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 69.9,
      contextWindow: 200_000,
    });
    expect(result).toContain("<dim>");
  });

  it("uses warning color at 70%", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 70,
      contextWindow: 200_000,
    });
    expect(result).toContain("<warning>");
  });

  it("uses error color at 90%", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 90,
      contextWindow: 200_000,
    });
    expect(result).toContain("<error>");
  });

  it("includes context window when present", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 50,
      contextWindow: 200_000,
    });
    expect(result).toContain("/200000");
  });

  it("omits context window when zero", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 50,
      contextWindow: 0,
    });
    expect(result).not.toContain("/0");
  });

  it("omits context window when null", () => {
    const result = renderContext(fakeTheme, icons, {
      percent: 50,
      contextWindow: null,
    });
    expect(result).not.toContain("/200000");
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
