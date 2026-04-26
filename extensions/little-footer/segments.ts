/**
 * Themed segment renderers for the little-footer extension.
 */

import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import type { IconSet } from "./icons.ts";
import { formatCost, formatPathBasename, formatPercent, formatTokens, sanitizeStatusText } from "./format.ts";
import { formatModelDisplay } from "./model-name.ts";

export interface ThemeFn {
  fg: (role: ThemeColor, text: string) => string;
}

export interface ContextSegmentInput {
  percent: number | null;
  contextWindow: number | null;
}

export interface GitDiffStats {
  added: number;
  deleted: number;
}

/** Thinking level display labels. */
const THINKING_LABELS: Record<string, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
};

/** Thinking level to theme color mapping. */
const THINKING_COLORS: Record<string, ThemeColor> = {
  off: "dim",
  minimal: "muted",
  low: "accent",
  medium: "accent",
  high: "warning",
  xhigh: "error",
};

/** Render the Pi marker. */
export function renderPi(theme: ThemeFn, icons: IconSet): string {
  return theme.fg("accent", icons.pi);
}

/** Render model segment. Returns null if modelId is empty/undefined. */
export function renderModel(
  theme: ThemeFn,
  icons: IconSet,
  modelId: string | undefined,
): string | null {
  if (!modelId) return null;
  const display = formatModelDisplay(modelId);
  if (!display) return null;
  return `${theme.fg("text", icons.model)} ${theme.fg("text", display)}`;
}

/** Render thinking level segment. Returns null if level is empty/undefined. */
export function renderThinking(
  theme: ThemeFn,
  icons: IconSet,
  level: string | undefined,
): string | null {
  if (level === undefined || level === "") return null;
  const label = THINKING_LABELS[level] ?? level;
  const color = THINKING_COLORS[level] ?? "dim";
  return `${theme.fg(color, icons.thinking)} ${theme.fg(color, label)}`;
}

/** Render path basename segment. */
export function renderPath(
  theme: ThemeFn,
  icons: IconSet,
  cwd: string,
): string {
  const basename = formatPathBasename(cwd);
  return `${theme.fg("text", icons.path)} ${theme.fg("text", basename)}`;
}

/** Render git branch segment. Returns null if branch is null.
 * When dirty is true, appends a * indicator after the branch name.
 */
export function renderGit(
  theme: ThemeFn,
  icons: IconSet,
  branch: string | null,
  dirty?: boolean,
  diffStats?: GitDiffStats | null,
): string | null {
  if (branch === null || branch === "") return null;
  let suffix = "";
  if (dirty) {
    if (diffStats && (diffStats.added > 0 || diffStats.deleted > 0)) {
      const parts: string[] = [];
      if (diffStats.added > 0) {
        parts.push(theme.fg("success", `+${diffStats.added}`));
      }
      if (diffStats.deleted > 0) {
        parts.push(theme.fg("error", `-${diffStats.deleted}`));
      }
      suffix = ` ${parts.join(" ")}`;
    } else {
      suffix = ` ${theme.fg("error", icons.dirty)}`;
    }
  }
  return `${theme.fg("success", icons.git)} ${theme.fg("success", branch)}${suffix}`;
}

/** Render token count segment. Returns null for zero tokens. */
export function renderTokens(
  theme: ThemeFn,
  icons: IconSet,
  totalTokens: number,
): string | null {
  if (totalTokens === 0) return null;
  return `${theme.fg("text", icons.tokens)} ${theme.fg("text", formatTokens(totalTokens))}`;
}

/** Render cost segment. Returns null for zero cost. */
export function renderCost(
  theme: ThemeFn,
  icons: IconSet,
  costUsd: number,
): string | null {
  if (costUsd === 0) return null;
  return `${theme.fg("text", icons.cost)} ${theme.fg("text", formatCost(costUsd))}`;
}

/** Render context usage segment. Returns null if input is null or percent is null. */
export function renderContext(
  theme: ThemeFn,
  icons: IconSet,
  input: ContextSegmentInput | null,
): string | null {
  if (!input || input.percent === null) return null;

  const color = input.percent >= 90 ? "error" : input.percent >= 70 ? "warning" : "dim";
  let text = `${theme.fg(color, icons.context)} ${formatPercent(input.percent)}`;

  // Include context window if available and non-zero
  if (input.contextWindow !== null && input.contextWindow > 0) {
    text += `/${input.contextWindow}`;
  }

  return text;
}

/** Render extension status segment. */
export function renderExtensionStatus(
  theme: ThemeFn,
  value: string,
): string {
  const sanitized = sanitizeStatusText(value);
  return theme.fg("muted", sanitized);
}

/** Render time segment. */
export function renderTime(
  theme: ThemeFn,
  icons: IconSet,
): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${theme.fg("muted", icons.time)} ${theme.fg("muted", `${hours}:${minutes}`)}`;
}
