/**
 * little-footer: a compact single-line status footer for Pi.
 */

import { spawnSync } from "node:child_process";

import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { detectNerdFonts, iconsFor, type IconSet } from "./icons.ts";
import { createCodexQuotaTracker, type QuotaTracker } from "./codex-usage.ts";
import {
  renderCost,
  renderExtensionStatus,
  renderGit,
  renderModel,
  renderPath,
  renderQuota,
  renderThinking,
  renderTime,
  renderTokens,
  type GitDiffStats,
  type ThemeFn,
} from "./segments.ts";

interface UsageTotals {
  input: number;
  output: number;
  cost: number;
}

interface GitDiffCacheEntry {
  snapshot: GitDiffStats | null;
  refreshedAt: number;
}

const GIT_DIFF_CACHE_TTL_MS = 2_000;
const gitDiffCache = new Map<string, GitDiffCacheEntry>();

/** Check if the git working directory has uncommitted changes.
 * Returns true when there are staged or unstaged modifications, new files, etc.
 */
function isGitDirty(cwd: string): boolean {
  try {
    const result = spawnSync("git", ["status", "--porcelain"], {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return false;
    const output = result.stdout?.toString() ?? "";
    // Any non-empty output means dirty
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/** Collect added/deleted line counts for the current git diff. */
function collectGitDiffStats(cwd: string): GitDiffStats | null {
  const parseNumstat = (output: string): GitDiffStats | null => {
    let added = 0;
    let deleted = 0;

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [addedText, deletedText] = trimmed.split(/\s+/, 3);
      const parsedAdded = Number.parseInt(addedText ?? "", 10);
      const parsedDeleted = Number.parseInt(deletedText ?? "", 10);
      if (!Number.isFinite(parsedAdded) || !Number.isFinite(parsedDeleted)) continue;
      added += parsedAdded;
      deleted += parsedDeleted;
    }

    return added > 0 || deleted > 0 ? { added, deleted } : null;
  };

  const runNumstat = (args: string[]): GitDiffStats | null => {
    const result = spawnSync("git", args, {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return null;
    return parseNumstat(result.stdout?.toString() ?? "");
  };

  try {
    const headStats = runNumstat(["diff", "--numstat", "--no-renames", "HEAD", "--"]);
    if (headStats) return headStats;

    const stagedStats = runNumstat(["diff", "--cached", "--numstat", "--no-renames", "--"]);
    const unstagedStats = runNumstat(["diff", "--numstat", "--no-renames", "--"]);
    if (!stagedStats && !unstagedStats) return null;

    return {
      added: (stagedStats?.added ?? 0) + (unstagedStats?.added ?? 0),
      deleted: (stagedStats?.deleted ?? 0) + (unstagedStats?.deleted ?? 0),
    };
  } catch {
    return null;
  }
}

/** Return cached git diff stats when fresh; otherwise recompute once per TTL. */
function collectGitDiffStatsCached(cwd: string): GitDiffStats | null {
  const cached = gitDiffCache.get(cwd);
  const now = Date.now();
  if (cached && now - cached.refreshedAt < GIT_DIFF_CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const snapshot = collectGitDiffStats(cwd);
  gitDiffCache.set(cwd, { snapshot, refreshedAt: now });
  return snapshot;
}

/** Collect cumulative token usage and cost from assistant messages in the session. */
function collectUsage(ctx: ExtensionContext): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cost: 0 };
  try {
    const branch = ctx.sessionManager.getBranch();
    if (!branch) return totals;

    for (const entry of branch) {
      if (entry.type !== "message") continue;
      const msg = entry.message as AgentMessage & { usage?: { input?: number; output?: number; cost?: { total?: number } } };
      if (msg.role !== "assistant") continue;

      const usage = msg.usage;
      if (!usage) continue;
      totals.input += usage.input ?? 0;
      totals.output += usage.output ?? 0;
      totals.cost += usage.cost?.total ?? 0;
    }
  } catch {
    // Defensive: ignore errors from session iteration
  }
  return totals;
}

/** Return true when the active model uses ChatGPT Codex subscription auth. */
function isOpenAICodexModel(model: { id?: string; provider?: string } | undefined): boolean {
  if (!model) return false;
  const providerValue =
    model.provider ??
    (model.id && model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : undefined);
  if (!providerValue) return false;
  const provider = providerValue.toLowerCase();
  return provider === "openai-codex" || /^openai-codex-\d+$/.test(provider);
}

/** Build a single footer line. */
function buildLine(
  theme: ThemeFn,
  icons: IconSet,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  footerData: ReadonlyFooterDataProvider,
  quotaTracker: QuotaTracker,
  width: number,
): string {
  if (width <= 0) return "";

  // Collect usage totals
  const usage = collectUsage(ctx);
  const totalTokens = usage.input + usage.output;

  // Read thinking level
  const thinkingLevel = pi.getThinkingLevel();

  // Read git branch
  const branch = footerData.getGitBranch();
  const gitDirty = isGitDirty(ctx.cwd);
  const gitDiff = gitDirty ? collectGitDiffStatsCached(ctx.cwd) : null;

  const showQuotaUsage = isOpenAICodexModel(ctx.model as { id?: string; provider?: string } | undefined);
  quotaTracker.setEnabled(showQuotaUsage);

  // Build left segments
  const leftSegments: string[] = [];
  const modelSegment = renderModel(theme, ctx.model?.id);
  if (modelSegment) leftSegments.push(modelSegment);
  const thinkingSegment = renderThinking(theme, icons, thinkingLevel);
  if (thinkingSegment) leftSegments.push(thinkingSegment);
  leftSegments.push(renderPath(theme, icons, ctx.cwd));
  const gitSegment = renderGit(theme, icons, branch, gitDirty, gitDiff);
  if (gitSegment) leftSegments.push(gitSegment);

  // Build right segments
  const rightSegments: string[] = [];
  const tokensSegment = renderTokens(theme, icons, totalTokens);
  if (tokensSegment) rightSegments.push(tokensSegment);
  const costSegment = renderCost(theme, icons, usage.cost);
  if (costSegment) rightSegments.push(costSegment);

  // Quota segment
  if (showQuotaUsage) {
    const quota = quotaTracker.getSnapshot();
    const quotaInput = quota
      ? {
          limitId: quota.limitId,
          limitName: quota.limitName,
          primary: quota.primary,
          secondary: quota.secondary,
        }
      : null;
    const quotaSegment = renderQuota(theme, icons, quotaInput);
    if (quotaSegment) rightSegments.push(quotaSegment);
  }

  // Extension statuses from footerData
  try {
    const statuses = footerData.getExtensionStatuses();
    for (const [, value] of statuses) {
      if (value && value.trim()) {
        rightSegments.push(renderExtensionStatus(theme, value));
      }
    }
  } catch {
    // Defensive: ignore errors reading statuses
  }

  // Time segment (far right)
  rightSegments.push(renderTime(theme, icons));

  const sep = ` ${theme.fg("border", icons.separator)} `;

  // Filter nulls (shouldn't happen but be safe)
  const leftFiltered = leftSegments.filter(Boolean);
  const rightFiltered = rightSegments.filter(Boolean);

  if (rightFiltered.length === 0) {
    return truncateToWidth(leftFiltered.join(sep), width);
  }

  // Compute padding between left and right sides
  const leftText = leftFiltered.join(sep);
  const rightText = rightFiltered.join(sep);
  const usedWidth = visibleWidth(leftText) + visibleWidth(sep) + visibleWidth(rightText);
  const minPadding = Math.max(1, width - usedWidth);

  if (minPadding <= 0) {
    // Not enough room for padding; just truncate the combined line
    return truncateToWidth(leftText + rightText, width);
  }

  const padding = " ".repeat(minPadding);
  const fullLine = leftText + padding + sep + rightText;
  return truncateToWidth(fullLine, width);
}

/** Activate the footer for the given context. */
function activateFooter(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  icons: IconSet,
): void {
  let invalidateRef: (() => void) | undefined;
  const quotaTracker = createCodexQuotaTracker(ctx, () => {
    invalidateRef?.();
  });

  ctx.ui.setFooter((_tui, theme, footerData) => {
    const themeFn: ThemeFn = {
      fg: (role, text) => theme.fg(role, text),
    };
    const component = {
      invalidate() {
        invalidateRef = () => component.invalidate();
      },
      render(width: number): string[] {
        return [buildLine(themeFn, icons, ctx, pi, footerData, quotaTracker, width)];
      },
      dispose() {
        quotaTracker.dispose();
      },
    };
    return component;
  });
}

/** Default export - the extension factory. */
export default function littleFooterExtension(pi: ExtensionAPI): void {
  const useNerd = detectNerdFonts();
  const icons = iconsFor(useNerd);
  let enabled = true;

  pi.on("session_start", (_event, ctx) => {
    if (enabled) {
      activateFooter(ctx, pi, icons);
    }
  });

  pi.registerCommand("footer", {
    description: "Toggle little-footer. Usage: /footer [on|off|status].",
    getArgumentCompletions: (prefix: string) => {
      const items = ["on", "off", "status"];
      const lower = prefix.toLowerCase();
      const matches = items
        .filter((value) => value.startsWith(lower))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args: string, ctx: ExtensionContext) => {
      const sub = args.trim().toLowerCase() || "status";
      const iconMode = useNerd ? "nerd icons" : "ascii icons";

      if (sub === "status") {
        ctx.ui.notify(`little-footer: ${enabled ? "on" : "off"} (${iconMode})`, "info");
      } else if (sub === "on") {
        enabled = true;
        activateFooter(ctx, pi, icons);
        ctx.ui.notify("little-footer: on", "info");
      } else if (sub === "off") {
        enabled = false;
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("little-footer: off (default footer restored)", "info");
      } else {
        ctx.ui.notify(`little-footer: unknown subcommand "${sub}". Use on|off|status.`, "warning");
      }
    },
  });
}
