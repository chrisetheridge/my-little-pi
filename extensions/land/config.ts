import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigLoadResult, LandingStep, LandingWorkflowConfig } from "./types.ts";

export function configPaths(cwd: string, home = homedir()): { global: string; project: string } {
  return {
    global: join(home, ".pi", "agent", "extensions", "land.json"),
    project: join(cwd, ".pi", "extensions", "land.json"),
  };
}

export function loadLandingWorkflowConfig(cwd: string, home = homedir()): ConfigLoadResult {
  const paths = configPaths(cwd, home);
  const source = existsSync(paths.project)
    ? paths.project
    : existsSync(paths.global)
      ? paths.global
      : undefined;

  if (!source) {
    return {
      ok: false,
      expectedProjectPath: paths.project,
      error: `No land workflow config found. Create ${paths.project} to enable /land.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source, "utf-8"));
  } catch (error) {
    return {
      ok: false,
      source,
      expectedProjectPath: paths.project,
      error: `Failed to read ${source}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const validation = validateLandingWorkflowConfig(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      source,
      expectedProjectPath: paths.project,
      error: validation.error,
    };
  }
  return { ok: true, source, config: validation.config };
}

export function validateLandingWorkflowConfig(
  value: unknown,
): { ok: true; config: LandingWorkflowConfig } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "Config must be a JSON object." };
  if (!Array.isArray(value.steps))
    return { ok: false, error: "Config must include a steps array." };
  if (value.steps.length === 0) return { ok: false, error: "Config steps must be non-empty." };

  const steps: LandingStep[] = [];
  for (let index = 0; index < value.steps.length; index += 1) {
    const raw = value.steps[index];
    if (!isRecord(raw)) return { ok: false, error: `Step ${index + 1} must be an object.` };
    if (!isNonEmptyString(raw.label)) {
      return {
        ok: false,
        error: `Step ${index + 1} must have a non-empty label.`,
      };
    }
    if (raw.type === "shell") {
      if (!isNonEmptyString(raw.command)) {
        return {
          ok: false,
          error: `Shell step ${index + 1} must have a non-empty command.`,
        };
      }
      steps.push({
        type: "shell",
        label: raw.label.trim(),
        command: raw.command.trim(),
      });
      continue;
    }
    if (raw.type === "commit") {
      if (!isNonEmptyString(raw.model)) {
        return {
          ok: false,
          error: `Commit step ${index + 1} must have a non-empty model.`,
        };
      }
      steps.push({
        type: "commit",
        label: raw.label.trim(),
        model: raw.model.trim(),
      });
      continue;
    }
    return {
      ok: false,
      error: `Step ${index + 1} has unknown type ${JSON.stringify(raw.type)}.`,
    };
  }

  return { ok: true, config: { steps } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
