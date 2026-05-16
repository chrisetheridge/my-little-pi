import path from "node:path";
import type { ExtensionAPI, ThemeColor, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";

const WIDGET_KEY = "session-changes";
const MAX_VISIBLE_FILES = 6;

type ChangeKind = "edit" | "write" | "untracked";

export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
  kinds: Set<ChangeKind>;
  touches: number;
  lastTouched: number;
}

export interface SessionChangesState {
  files: Map<string, ChangedFile>;
  sequence: number;
}

interface ChangeRecord {
  path: string;
  added: number;
  deleted: number;
  kind: ChangeKind;
}

export function createSessionChangesState(): SessionChangesState {
  return { files: new Map(), sequence: 0 };
}

export function normalizeToolPath(cwd: string, filePath: unknown): string | undefined {
  if (typeof filePath !== "string" || filePath.trim().length === 0) return undefined;
  const withoutAt = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  const absolute = path.isAbsolute(withoutAt) ? withoutAt : path.resolve(cwd, withoutAt);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolute;
  return relative;
}

export function countDiffLines(diff: unknown): { added: number; deleted: number } {
  if (typeof diff !== "string") return { added: 0, deleted: 0 };

  let added = 0;
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
}

export function countContentLines(content: unknown): number {
  if (typeof content !== "string" || content.length === 0) return 0;
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  return lines.length;
}

export function applyChange(state: SessionChangesState, change: ChangeRecord): void {
  const current = state.files.get(change.path);
  state.sequence += 1;

  if (!current) {
    state.files.set(change.path, {
      path: change.path,
      added: change.added,
      deleted: change.deleted,
      kinds: new Set([change.kind]),
      touches: 1,
      lastTouched: state.sequence,
    });
    return;
  }

  current.added += change.added;
  current.deleted += change.deleted;
  current.kinds.add(change.kind);
  current.touches += 1;
  current.lastTouched = state.sequence;
}

export function getChangedFiles(state: SessionChangesState): ChangedFile[] {
  return [...state.files.values()].sort((a, b) => b.lastTouched - a.lastTouched);
}

export function parseGitStatusPorcelain(status: string): string[] {
  const paths: string[] = [];

  for (const line of status.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const filePath = line.slice(3).trim();
    if (filePath.length > 0) paths.push(filePath);
  }

  return paths;
}

export function applyGitStatusPorcelain(
  state: SessionChangesState,
  cwd: string,
  status: string,
): boolean {
  let changed = false;

  for (const rawPath of parseGitStatusPorcelain(status)) {
    const normalized = normalizeToolPath(cwd, rawPath);
    if (!normalized || state.files.has(normalized)) continue;
    applyChange(state, {
      path: normalized,
      added: 0,
      deleted: 0,
      kind: "untracked",
    });
    changed = true;
  }

  return changed;
}

async function refreshGitStatus(
  pi: ExtensionAPI,
  state: SessionChangesState,
  cwd: string,
): Promise<boolean> {
  try {
    const result = await pi.exec("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      timeout: 5_000,
    });
    if (result.code !== 0) return false;
    return applyGitStatusPorcelain(state, cwd, result.stdout);
  } catch {
    return false;
  }
}

function extractChangeRecord(source: {
  toolName?: unknown;
  input?: unknown;
  details?: unknown;
  isError?: unknown;
}): (Omit<ChangeRecord, "path"> & { rawPath: unknown }) | undefined {
  if (source.isError === true) return undefined;
  if (!source.input || typeof source.input !== "object") return undefined;

  const input = source.input as { path?: unknown; content?: unknown };
  if (source.toolName === "edit") {
    const details = source.details as { diff?: unknown } | undefined;
    const counts = countDiffLines(details?.diff);
    return { rawPath: input.path, added: counts.added, deleted: counts.deleted, kind: "edit" };
  }

  if (source.toolName === "write") {
    return {
      rawPath: input.path,
      added: countContentLines(input.content),
      deleted: 0,
      kind: "write",
    };
  }

  return undefined;
}

export function applyToolResult(
  state: SessionChangesState,
  cwd: string,
  event: Pick<ToolResultEvent, "toolName" | "input" | "details" | "isError">,
): boolean {
  const extracted = extractChangeRecord(event);
  if (!extracted) return false;

  const normalized = normalizeToolPath(cwd, extracted.rawPath);
  if (!normalized) return false;

  applyChange(state, { path: normalized, ...extracted });
  return true;
}

function getMessageFromEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as { type?: unknown; message?: unknown };
  if (candidate.type === "message") return candidate.message;
  return undefined;
}

export function rebuildFromSessionEntries(
  state: SessionChangesState,
  cwd: string,
  entries: unknown[],
): void {
  state.files.clear();
  state.sequence = 0;

  const toolInputs = new Map<string, { toolName?: unknown; input?: unknown }>();

  for (const entry of entries) {
    const message = getMessageFromEntry(entry);
    if (!message || typeof message !== "object") continue;

    const maybeAssistant = message as { role?: unknown; content?: unknown };
    if (maybeAssistant.role === "assistant" && Array.isArray(maybeAssistant.content)) {
      for (const block of maybeAssistant.content) {
        if (!block || typeof block !== "object") continue;
        const toolCall = block as {
          type?: unknown;
          id?: unknown;
          name?: unknown;
          arguments?: unknown;
        };
        if (toolCall.type !== "toolCall" || typeof toolCall.id !== "string") continue;
        toolInputs.set(toolCall.id, { toolName: toolCall.name, input: toolCall.arguments });
      }
      continue;
    }

    const toolMessage = message as {
      role?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      input?: unknown;
      details?: unknown;
      isError?: unknown;
    };
    if (toolMessage.role !== "toolResult") continue;

    const toolCall =
      typeof toolMessage.toolCallId === "string"
        ? toolInputs.get(toolMessage.toolCallId)
        : undefined;
    applyToolResult(state, cwd, {
      ...toolMessage,
      toolName: toolMessage.toolName ?? toolCall?.toolName,
      input: toolMessage.input ?? toolCall?.input,
    } as never);
  }
}

export class SessionChangesWidget implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly state: SessionChangesState,
    private readonly theme: {
      fg: (role: ThemeColor, text: string) => string;
      bold: (text: string) => string;
    },
  ) {}

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;

    const files = getChangedFiles(this.state);
    if (files.length === 0) {
      this.cachedWidth = width;
      this.cachedLines = [];
      return this.cachedLines;
    }

    const lines: string[] = [];
    const title = this.theme.fg("accent", this.theme.bold("changes"));
    const count = this.theme.fg("muted", ` ${files.length} file${files.length === 1 ? "" : "s"}`);
    lines.push(truncateToWidth(`${title}${count}`, width));

    for (const file of files.slice(0, MAX_VISIBLE_FILES)) {
      const marker = this.theme.fg("accent", "-");
      const pathText = this.theme.fg("text", file.path);
      const added = file.added > 0 ? ` ${this.theme.fg("toolDiffAdded", `+${file.added}`)}` : "";
      const deleted =
        file.deleted > 0 ? ` ${this.theme.fg("toolDiffRemoved", `-${file.deleted}`)}` : "";
      lines.push(truncateToWidth(`${marker} ${pathText}${added}${deleted}`, width));
    }

    const hidden = files.length - MAX_VISIBLE_FILES;
    if (hidden > 0) {
      lines.push(truncateToWidth(this.theme.fg("dim", `… ${hidden} more changed`), width));
    }

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function sessionChangesExtension(pi: ExtensionAPI): void {
  const state = createSessionChangesState();
  let widget: SessionChangesWidget | undefined;
  let requestRender: (() => void) | undefined;

  const refresh = () => {
    widget?.invalidate();
    requestRender?.();
  };

  pi.on("session_start", async (_event, ctx) => {
    rebuildFromSessionEntries(state, ctx.cwd, ctx.sessionManager.getBranch());
    await refreshGitStatus(pi, state, ctx.cwd);
    if (!ctx.hasUI) return;

    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      widget = new SessionChangesWidget(state, theme);
      requestRender = () => tui.requestRender();
      return widget;
    });
    refresh();
  });

  pi.on("tool_result", async (event, ctx) => {
    const toolChanged = applyToolResult(state, ctx.cwd, event);
    const shouldCheckGit =
      event.isError !== true && ["bash", "edit", "write"].includes(event.toolName);
    const gitChanged = shouldCheckGit ? await refreshGitStatus(pi, state, ctx.cwd) : false;
    if (toolChanged || gitChanged) refresh();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
    widget = undefined;
    requestRender = undefined;
  });
}
