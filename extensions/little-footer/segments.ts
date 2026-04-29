/**
 * Themed segment renderers for the little-footer extension.
 */

import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { IconSet } from "./icons.ts";
import { formatCost, formatPathBasename, formatTokens, sanitizeStatusText } from "./format.ts";
import { formatModelDisplay } from "./model-name.ts";

export interface ThemeFn {
  fg: (role: ThemeColor, text: string) => string;
}

export interface QuotaWindowInput {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface QuotaSegmentInput {
  limitId: string | null;
  limitName: string | null;
  primary: QuotaWindowInput | null;
  secondary: QuotaWindowInput | null;
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

/** Render model segment. Returns null if modelId is empty/undefined. */
export function renderModel(
  theme: ThemeFn,
  modelId: string | undefined,
): string | null {
  if (!modelId) return null;
  const display = formatModelDisplay(modelId);
  if (!display) return null;
  return `${theme.fg("text", display)}`;
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
  const branchName = truncateToWidth(branch, 15);
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
  return `${theme.fg("success", icons.git)} ${theme.fg("success", branchName)}${suffix}`;
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

function formatWindowDuration(windowDurationMins: number | null): string | null {
  if (windowDurationMins === null || windowDurationMins <= 0) return null;
  if (windowDurationMins % (60 * 24 * 7) === 0) {
    return `${windowDurationMins / (60 * 24 * 7)}w`;
  }
  if (windowDurationMins % (60 * 24) === 0) {
    return `${windowDurationMins / (60 * 24)}d`;
  }
  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`;
  }
  return `${windowDurationMins}m`;
}

function formatPercentCompact(value: number): string {
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${rounded}%`;
}

function renderQuotaWindow(
  theme: ThemeFn,
  window: QuotaWindowInput,
): string | null {
  if (!Number.isFinite(window.usedPercent)) return null;
  const availablePercent = Math.max(0, 100 - window.usedPercent);
  const color = window.usedPercent >= 90 ? "error" : window.usedPercent >= 70 ? "warning" : "dim";
  const label = formatWindowDuration(window.windowDurationMins);
  const percentText = `${formatPercentCompact(availablePercent)}`;

  if (label) {
    return `${theme.fg(color, label)} ${theme.fg(color, percentText)}`;
  }
  return theme.fg(color, percentText);
}

/** Render quota usage segment. Returns null if usage is unavailable. */
export function renderQuota(
  theme: ThemeFn,
  icons: IconSet,
  input: QuotaSegmentInput | null,
): string | null {
  if (!input) {
    return null;
  }

  const windows = [input.primary, input.secondary].filter((value): value is QuotaWindowInput => {
    return value !== null;
  });
  if (windows.length === 0) return null;

  const renderedWindows = windows
    .map((window) => renderQuotaWindow(theme, window))
    .filter((value): value is string => value !== null);
  if (renderedWindows.length === 0) return null;

  const label = input.limitName?.trim() || "OpenAI";
  const separator = ` ${theme.fg("muted", "·")} `;
  return `${theme.fg("accent", icons.context)} ${theme.fg("text", label)} ${renderedWindows.join(separator)}`;
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
