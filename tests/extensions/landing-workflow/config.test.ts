import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLandingWorkflowConfig, validateLandingWorkflowConfig } from "../../../extensions/land/config.ts";

function dirs(): { cwd: string; home: string; projectConfig: string; globalConfig: string } {
  const root = mkdtempSync(join(tmpdir(), "landing-config-"));
  const cwd = join(root, "repo");
  const home = join(root, "home");
  const projectConfig = join(cwd, ".pi", "extensions", "land.json");
  const globalConfig = join(home, ".pi", "agent", "extensions", "land.json");
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
  return { cwd, home, projectConfig, globalConfig };
}

const valid = {
  steps: [
    { type: "shell", label: "Tests", command: "pnpm test" },
    { type: "commit", label: "Commit", model: "sonnet" },
  ],
};

describe("landing workflow config", () => {
  it("returns disabled error when no config exists", () => {
    const { cwd, home, projectConfig } = dirs();
    const result = loadLandingWorkflowConfig(cwd, home);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No landing workflow config found");
      expect(result.expectedProjectPath).toBe(projectConfig);
    }
  });

  it("project config overrides global config", () => {
    const { cwd, home, projectConfig, globalConfig } = dirs();
    writeFileSync(globalConfig, JSON.stringify({ steps: [{ type: "shell", label: "Global", command: "echo global" }] }));
    writeFileSync(projectConfig, JSON.stringify(valid));
    const result = loadLandingWorkflowConfig(cwd, home);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe(projectConfig);
      expect(result.config.steps[0].label).toBe("Tests");
    }
  });

  it("reports invalid JSON", () => {
    const { cwd, home, projectConfig } = dirs();
    writeFileSync(projectConfig, "{");
    const result = loadLandingWorkflowConfig(cwd, home);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Failed to read");
  });

  it.each([
    ["missing steps", {}, "steps array"],
    ["empty steps", { steps: [] }, "non-empty"],
    ["bad step type", { steps: [{ type: "noop", label: "Noop" }] }, "unknown type"],
    ["missing label", { steps: [{ type: "shell", command: "echo hi" }] }, "label"],
    ["missing shell command", { steps: [{ type: "shell", label: "Shell" }] }, "command"],
    ["missing commit model", { steps: [{ type: "commit", label: "Commit" }] }, "model"],
  ])("rejects %s", (_name, config, message) => {
    const result = validateLandingWorkflowConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("normalizes a valid hybrid config", () => {
    const result = validateLandingWorkflowConfig({
      steps: [
        { type: "shell", label: " Tests ", command: " pnpm test " },
        { type: "commit", label: " Commit ", model: " sonnet " },
      ],
    });
    expect(result).toEqual({
      ok: true,
      config: {
        steps: [
          { type: "shell", label: "Tests", command: "pnpm test" },
          { type: "commit", label: "Commit", model: "sonnet" },
        ],
      },
    });
  });
});
