import type { ExtensionAPI, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import {
  AssistantMessageComponent,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  renderDiff,
} from "@mariozechner/pi-coding-agent";
import { Markdown, Text } from "@mariozechner/pi-tui";

const ESC = "\u001b";
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const ANSI_PRESENT_RE = new RegExp(`${ESC}\\[[0-9;]*m`);
const ASSISTANT_PATCH_FLAG = Symbol.for("little-renderer:assistant-message-patched");

const BLINK_INTERVAL_MS = 500;
type BlinkStatus = "pending" | "success" | "error";
type BlinkEntry = { invalidate: () => void; active: boolean };
type MutableRecord = Record<string | symbol, unknown>;
type MessageContentBlock = { type?: unknown; thinking?: unknown; text?: unknown };
type AssistantLikeMessage = { role?: unknown; content?: MessageContentBlock[] };
type MessageEvent = { message?: AssistantLikeMessage; messages?: AssistantLikeMessage[] };
type ToolResult = {
  content?: Array<{ type?: unknown; text?: unknown }>;
  details?: {
    truncation?: { truncated?: unknown; totalLines?: unknown };
    diff?: unknown;
  };
};
type LocalToolRenderContext = {
  cwd: string;
  expanded?: boolean;
  executionStarted?: boolean;
  invalidate?: () => void;
  isError?: boolean;
  isPartial?: boolean;
  state?: MutableRecord;
};
type SimpleFileArgs = {
  path?: string;
  pattern?: string;
  glob?: string;
  command?: string;
  content?: string;
};
type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type CompactTool = Omit<RegisteredTool, "renderCall" | "renderResult">;
const blinkEntries = new Map<unknown, BlinkEntry>();
let blinkTimer: ReturnType<typeof setTimeout> | null = null;
let blinkPhase = true;
let toolRenderersInstalled = false;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function stripThinkingPresentationArtifacts(text: string): string {
  if (!ANSI_PRESENT_RE.test(text) && !/^\s*thinking:\s*/i.test(text)) return text;
  let current = ANSI_PRESENT_RE.test(text) ? text.replace(ANSI_RE, "") : text;
  while (true) {
    const next = current.replace(/^(?:thinking:\s*)+/i, "").trimStart();
    if (next === current) return current;
    current = next;
  }
}

function prefixThinkingLine(text: string): string {
  if (
    !ANSI_PRESENT_RE.test(text) &&
    text.startsWith("Thinking: ") &&
    !/^Thinking:\s*thinking:\s*/i.test(text)
  ) {
    return text;
  }
  const normalized = stripThinkingPresentationArtifacts(text).trim();
  if (!normalized) return text;
  return `Thinking: ${normalized}`;
}

function registerThinkingLabels(pi: ExtensionAPI): void {
  const patchMessage = (event: unknown) => {
    const message =
      typeof event === "object" && event !== null && "message" in event
        ? (event.message as AssistantLikeMessage | undefined)
        : undefined;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (block && block.type === "thinking" && typeof block.thinking === "string") {
        block.thinking = prefixThinkingLine(block.thinking);
      }
    }
  };

  pi.on("message_update", async (event) => patchMessage(event));
  pi.on("message_end", async (event) => patchMessage(event));
  pi.on("context", async (event) => {
    const messages = (event as MessageEvent).messages;
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block && block.type === "thinking" && typeof block.thinking === "string") {
          block.thinking = stripThinkingPresentationArtifacts(block.thinking);
        }
      }
    }
  });
}

function sanitizeRenderedTextBlockLines(lines: string[]): string[] {
  let inFence = false;
  return lines.map((line) => {
    const plain = stripAnsi(line).trimStart();
    if (plain.startsWith("```")) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const headingPrefixRe = new RegExp(
      `^((?:${ESC}\\[[0-9;]*m|[ \\t])*)#{3,6}[ \\t]*((?:${ESC}\\[[0-9;]*m)*)`,
    );
    return line.replace(headingPrefixRe, "$1$2").replace(/###/g, "");
  });
}

class DottedParagraph {
  private md: InstanceType<typeof Markdown>;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(text: string, markdownTheme: ConstructorParameters<typeof Markdown>[3]) {
    this.md = new Markdown(text, 0, 0, markdownTheme);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.md.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const prefixWidth = 3;
    if (width <= prefixWidth) {
      this.cachedWidth = width;
      this.cachedLines = [" ● "];
      return this.cachedLines;
    }

    const lines = sanitizeRenderedTextBlockLines(this.md.render(width - prefixWidth));
    let dotPlaced = false;
    const rendered = lines.map((line) => {
      if (!dotPlaced && stripAnsi(line).trim()) {
        dotPlaced = true;
        return ` ● ${line}`;
      }
      return `   ${line}`;
    });

    this.cachedWidth = width;
    this.cachedLines = rendered;
    return rendered;
  }
}

class ThinkingParagraph {
  private md: InstanceType<typeof Markdown>;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    text: string,
    _markdownTheme: ConstructorParameters<typeof Markdown>[3],
    _defaultTextStyle?: ConstructorParameters<typeof Markdown>[4],
  ) {
    const dimFg = "\u001b[38;2;140;140;140m";
    const italic = "\u001b[3m";
    const wrap = (s: string) => `${dimFg}${italic}${s}`;
    const plainTheme: ConstructorParameters<typeof Markdown>[3] = {
      heading: wrap,
      link: wrap,
      linkUrl: wrap,
      code: wrap,
      codeBlock: wrap,
      codeBlockBorder: wrap,
      quote: wrap,
      quoteBorder: wrap,
      hr: wrap,
      listBullet: wrap,
      bold: wrap,
      italic: wrap,
      strikethrough: wrap,
      underline: wrap,
      highlightCode: (code: string) => code.split("\n").map((line) => `${dimFg}${italic}${line}`),
    };
    const plainStyle: ConstructorParameters<typeof Markdown>[4] = {
      italic: true,
      color: (s: string) => `${dimFg}${italic}${s}`,
    };
    this.md = new Markdown(text, 0, 0, plainTheme, plainStyle);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.md.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const prefixWidth = 3;
    if (width <= prefixWidth) {
      this.cachedWidth = width;
      this.cachedLines = [" ✽ "];
      return this.cachedLines;
    }

    const lines = sanitizeRenderedTextBlockLines(this.md.render(width - prefixWidth));
    let symbolPlaced = false;
    const rendered = lines.map((line) => {
      if (!symbolPlaced && stripAnsi(line).trim()) {
        symbolPlaced = true;
        return ` ✽ ${line}`;
      }
      return `   ${line}`;
    });

    this.cachedWidth = width;
    this.cachedLines = rendered;
    return rendered;
  }
}

type AssistantMessagePatchTarget = {
  updateContent: (message: unknown) => void;
  contentContainer?: { children?: unknown[] };
  markdownTheme: ConstructorParameters<typeof Markdown>[3];
  [key: symbol]: unknown;
};

type MarkdownInternals = {
  text?: string;
  defaultTextStyle?: ConstructorParameters<typeof Markdown>[4];
};

function patchAssistantMessages(): void {
  const proto = AssistantMessageComponent.prototype as unknown as AssistantMessagePatchTarget;
  if (proto[ASSISTANT_PATCH_FLAG]) return;

  const originalUpdateContent = proto.updateContent;
  proto.updateContent = function patchedUpdateContent(
    this: AssistantMessagePatchTarget,
    message: unknown,
  ) {
    if (
      typeof message !== "object" ||
      message === null ||
      !("content" in message) ||
      !Array.isArray(message.content)
    ) {
      return originalUpdateContent.call(this, message);
    }

    originalUpdateContent.call(this, message);

    const container = this.contentContainer;
    if (!container?.children) return;
    const mdTheme = this.markdownTheme;

    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i];
      if (child instanceof Markdown) {
        const markdown = child as unknown as MarkdownInternals;
        const text = markdown.text;
        if (!text) continue;
        const isThinking = !!markdown.defaultTextStyle?.italic;
        if (isThinking) {
          container.children[i] = new ThinkingParagraph(text, mdTheme, markdown.defaultTextStyle);
        } else {
          container.children[i] = new DottedParagraph(text, mdTheme);
        }
      }
    }
  };

  proto[ASSISTANT_PATCH_FLAG] = true;
}

function getBlinkKey(ctx: LocalToolRenderContext): unknown {
  return ctx?.state ?? ctx;
}

function scheduleBlinkTimer(): void {
  if (blinkTimer || blinkEntries.size === 0) return;
  blinkTimer = setTimeout(() => {
    blinkTimer = null;
    blinkPhase = !blinkPhase;
    for (const entry of blinkEntries.values()) {
      entry.invalidate();
    }
    scheduleBlinkTimer();
  }, BLINK_INTERVAL_MS);
}

function stopBlinkTimerIfEmpty(): void {
  if (blinkTimer && blinkEntries.size === 0) {
    clearTimeout(blinkTimer);
    blinkTimer = null;
  }
}

function setupBlinkTimer(ctx: LocalToolRenderContext): void {
  const key = getBlinkKey(ctx);
  if (!key) return;
  const invalidateFn = ctx.invalidate;
  const invalidate = typeof invalidateFn === "function" ? () => invalidateFn() : () => {};
  const existing = blinkEntries.get(key);
  if (existing) {
    existing.invalidate = invalidate;
    return;
  }
  blinkEntries.set(key, { invalidate, active: true });
  scheduleBlinkTimer();
}

function clearBlinkTimer(ctx: LocalToolRenderContext): void {
  const key = getBlinkKey(ctx);
  if (!key) return;
  blinkEntries.delete(key);
  stopBlinkTimerIfEmpty();
}

function blinkDot(ctx: LocalToolRenderContext, theme: Theme): string {
  setupBlinkTimer(ctx);
  return blinkPhase ? theme.fg("success", "●") : theme.fg("muted", "○");
}

function setToolStatus(ctx: LocalToolRenderContext, status: BlinkStatus): void {
  if (ctx?.state) {
    ctx.state._toolStatus = status;
  }
}

function syncToolCallStatus(ctx: LocalToolRenderContext): void {
  if (!ctx?.executionStarted || ctx?.isPartial) {
    setToolStatus(ctx, "pending");
    return;
  }
  setToolStatus(ctx, ctx.isError ? "error" : "success");
}

function toolStatusDot(ctx: LocalToolRenderContext, theme: Theme): string {
  const status = ctx.state?._toolStatus as BlinkStatus | undefined;
  if (status === "success") return `${theme.fg("success", "●")} `;
  if (status === "error") return `${theme.fg("error", "●")} `;
  return `${blinkDot(ctx, theme)} `;
}

function branchLead(text: string): string {
  return `└─ ${text}`;
}

function branchIndent(text: string): string {
  return `   ${text}`;
}

function withBranch(content: string): string {
  if (!content.trim()) return "";
  const lines = content.split("\n");
  if (lines.length === 1) return branchLead(lines[0] ?? "");
  return `${branchLead(lines[0] ?? "")}\n${lines.slice(1).map(branchIndent).join("\n")}`;
}

function shortPath(cwd: string, filePath: string): string {
  if (!filePath) return "";
  if (filePath.startsWith(cwd)) {
    const rel = filePath.slice(cwd.length).replace(/^\/+/, "");
    return rel || ".";
  }
  const home = process.env.HOME ?? "";
  return home ? filePath.replace(home, "~") : filePath;
}

function firstTextContent(result: ToolResult): string {
  const content = result.content?.[0];
  return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function createCallHeader(
  theme: Theme,
  toolLabel: string,
  summary: string,
  ctx: LocalToolRenderContext,
): string {
  const label = theme.fg("toolTitle", theme.bold(toolLabel));
  const suffix = summary ? ` ${theme.fg("accent", summary)}` : "";
  return `${toolStatusDot(ctx, theme)}${label}${suffix}`;
}

function renderPreviewLines(text: string, theme: Theme, limit = 20): string {
  const lines = text.split("\n").slice(0, limit);
  return lines.map((line) => theme.fg("dim", line || " ")).join("\n");
}

function renderReadCall(
  args: { path?: string; offset?: number; limit?: number },
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  syncToolCallStatus(ctx);
  const summary = args.path ? shortPath(ctx.cwd, args.path) : theme.fg("muted", "file");
  const suffix: string[] = [];
  if (typeof args.offset === "number") suffix.push(`offset=${args.offset}`);
  if (typeof args.limit === "number") suffix.push(`limit=${args.limit}`);
  const extra = suffix.length > 0 ? theme.fg("dim", ` (${suffix.join(", ")})`) : "";
  return new Text(createCallHeader(theme, "Read", summary + extra, ctx), 0, 0);
}

function renderReadResult(
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  if (options.isPartial) {
    setupBlinkTimer(ctx);
    return new Text(withBranch(theme.fg("warning", "Reading...")), 0, 0);
  }
  clearBlinkTimer(ctx);
  setToolStatus(ctx, ctx.isError ? "error" : "success");

  const text = firstTextContent(result);
  const lineCount = text ? countNonEmptyLines(text) : 0;
  let summary = theme.fg(ctx.isError ? "error" : "success", `${lineCount} lines loaded`);
  if (result.details?.truncation?.truncated) {
    const total = result.details.truncation.totalLines ?? lineCount;
    summary += theme.fg("warning", ` (truncated from ${total})`);
  }
  if (!options.expanded) {
    summary += theme.fg("muted", " • Ctrl+O to expand");
    return new Text(withBranch(summary), 0, 0);
  }
  return new Text(`${withBranch(summary)}\n${renderPreviewLines(text, theme)}`, 0, 0);
}

function renderBashCall(
  args: { command?: string; timeout?: number },
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  syncToolCallStatus(ctx);
  const cmd = args.command ?? "";
  const summary = cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
  const timeout =
    typeof args.timeout === "number" ? theme.fg("dim", ` (timeout: ${args.timeout}s)`) : "";
  return new Text(createCallHeader(theme, "$", summary + timeout, ctx), 0, 0);
}

function renderBashResult(
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  if (options.isPartial) {
    setupBlinkTimer(ctx);
    return new Text(withBranch(theme.fg("warning", "Running...")), 0, 0);
  }
  clearBlinkTimer(ctx);
  setToolStatus(ctx, ctx.isError ? "error" : "success");

  const text = firstTextContent(result).trim();
  const exitMatch = text.match(/exit code:\s*(\d+)/i);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? "", 10) : null;
  const lineCount = text ? countNonEmptyLines(text) : 0;
  let summary =
    exitCode && exitCode !== 0
      ? theme.fg("error", `exit ${exitCode}`)
      : theme.fg("success", "done");
  summary += theme.fg("dim", ` (${lineCount} lines)`);

  if (!options.expanded) {
    return new Text(withBranch(summary), 0, 0);
  }
  return new Text(`${withBranch(summary)}\n${renderPreviewLines(text, theme)}`, 0, 0);
}

function buildSimpleFileSummary(
  name: string,
  args: SimpleFileArgs,
  theme: Theme,
  ctx: LocalToolRenderContext,
): string {
  if (name === "grep" && args.pattern) {
    let summary = JSON.stringify(args.pattern);
    if (args.path) summary += theme.fg("muted", ` in ${shortPath(ctx.cwd, args.path)}`);
    if (args.glob) summary += theme.fg("dim", ` --glob ${args.glob}`);
    return summary;
  }
  if (name === "find" && args.path) return shortPath(ctx.cwd, args.path);
  if (name === "ls" && args.path) return shortPath(ctx.cwd, args.path);
  if (name === "write" && args.path) {
    let summary = shortPath(ctx.cwd, args.path);
    if (typeof args.content === "string") {
      summary += theme.fg("dim", ` (${countNonEmptyLines(args.content)} lines)`);
    }
    return summary;
  }
  if (name === "edit" && args.path) return shortPath(ctx.cwd, args.path);
  return args.path ?? args.command ?? "";
}

function renderSimpleFileCall(
  name: string,
  args: SimpleFileArgs,
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  syncToolCallStatus(ctx);
  const summary = buildSimpleFileSummary(name, args, theme, ctx);
  return new Text(
    createCallHeader(theme, `${name[0].toUpperCase()}${name.slice(1)}`, summary, ctx),
    0,
    0,
  );
}

function renderEditCall(args: { path?: string }, theme: Theme, ctx: LocalToolRenderContext): Text {
  syncToolCallStatus(ctx);
  const summary = args.path ? shortPath(ctx.cwd, args.path) : theme.fg("muted", "file");
  const header = createCallHeader(theme, "Edit", summary, ctx);
  const diff = typeof ctx?.state?.editDiff === "string" ? ctx.state.editDiff : "";
  if (ctx?.expanded && diff) {
    return new Text(`${header}\n${renderDiff(diff)}`, 0, 0);
  }
  const counts = ctx?.state?.editChangeCounts as { added?: number; deleted?: number } | undefined;
  if (!counts) {
    return new Text(header, 0, 0);
  }
  const parts: string[] = [];
  if ((counts.added ?? 0) > 0) parts.push(theme.fg("success", `+${counts.added}`));
  if ((counts.deleted ?? 0) > 0) parts.push(theme.fg("error", `-${counts.deleted}`));
  if (parts.length === 0) {
    return new Text(header, 0, 0);
  }
  return new Text(`${header} ${parts.join(" ")}`, 0, 0);
}

function scheduleEditHeaderRefresh(ctx: LocalToolRenderContext): void {
  const state = ctx?.state;
  if (!state || state._editHeaderRefreshScheduled) return;
  state._editHeaderRefreshScheduled = true;
  queueMicrotask(() => {
    state._editHeaderRefreshScheduled = false;
    if (typeof ctx.invalidate === "function") {
      ctx.invalidate();
    }
  });
}

function renderEditResult(
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  if (options.isPartial) {
    setupBlinkTimer(ctx);
    return new Text(withBranch(theme.fg("warning", "Editing...")), 0, 0);
  }
  clearBlinkTimer(ctx);
  setToolStatus(ctx, ctx.isError ? "error" : "success");

  const diff =
    typeof result.details?.diff === "string" && result.details.diff.trim().length > 0
      ? result.details.diff
      : undefined;
  const counts = diff ? countEditDiffLines(diff) : undefined;
  const changeSummary = counts ? formatEditChangeSummary(counts) : "";
  if (
    ctx?.state &&
    (ctx.state.editChangeSummary !== changeSummary || ctx.state.editDiff !== diff)
  ) {
    ctx.state.editChangeSummary = changeSummary;
    ctx.state.editChangeCounts = counts;
    ctx.state.editDiff = diff;
    scheduleEditHeaderRefresh(ctx);
  }

  return new Text(
    withBranch(theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Applied")),
    0,
    0,
  );
}

function countEditDiffLines(diff: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      deleted += 1;
    }
  }

  return { added, deleted };
}

function formatEditChangeSummary(counts: { added: number; deleted: number }): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`+${counts.added}`);
  if (counts.deleted > 0) parts.push(`-${counts.deleted}`);
  return parts.join(" ");
}

function renderSimpleFileResult(
  name: string,
  result: ToolResult,
  options: ToolRenderResultOptions,
  theme: Theme,
  ctx: LocalToolRenderContext,
): Text {
  if (options.isPartial) {
    setupBlinkTimer(ctx);
    const label =
      name === "grep"
        ? "Searching..."
        : name === "find"
          ? "Finding..."
          : name === "ls"
            ? "Listing..."
            : name === "write"
              ? "Writing..."
              : name === "edit"
                ? "Editing..."
                : "Working...";
    return new Text(withBranch(theme.fg("warning", label)), 0, 0);
  }
  clearBlinkTimer(ctx);
  setToolStatus(ctx, ctx.isError ? "error" : "success");

  const text = firstTextContent(result).trim();
  if (name === "write") {
    return new Text(
      withBranch(theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Written")),
      0,
      0,
    );
  }
  if (name === "edit") {
    return new Text(
      withBranch(theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Applied")),
      0,
      0,
    );
  }

  const lineCount = text ? countNonEmptyLines(text) : 0;
  const summary = theme.fg(ctx.isError ? "error" : "success", `${lineCount} lines`);
  if (!options.expanded) {
    return new Text(withBranch(summary), 0, 0);
  }
  return new Text(`${withBranch(summary)}\n${renderPreviewLines(text, theme)}`, 0, 0);
}

function registerCompactTool(
  pi: ExtensionAPI,
  tool: CompactTool,
  renderCall: (args: unknown, theme: Theme, ctx: unknown) => Text,
  renderResult: (
    result: unknown,
    options: ToolRenderResultOptions,
    theme: Theme,
    ctx: unknown,
  ) => Text,
): void {
  pi.registerTool({
    ...tool,
    renderCall: renderCall as RegisteredTool["renderCall"],
    renderResult: renderResult as RegisteredTool["renderResult"],
  });
}

function patchToolExecutionRenderers(pi: ExtensionAPI): void {
  if (toolRenderersInstalled) return;

  const cwd = process.cwd();

  registerCompactTool(
    pi,
    createReadTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderReadCall(
        args as { path?: string; offset?: number; limit?: number },
        theme,
        ctx as LocalToolRenderContext,
      ),
    (result, options, theme, ctx) =>
      renderReadResult(result as ToolResult, options, theme, ctx as LocalToolRenderContext),
  );
  registerCompactTool(
    pi,
    createBashTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderBashCall(
        args as { command?: string; timeout?: number },
        theme,
        ctx as LocalToolRenderContext,
      ),
    (result, options, theme, ctx) =>
      renderBashResult(result as ToolResult, options, theme, ctx as LocalToolRenderContext),
  );
  registerCompactTool(
    pi,
    createGrepTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderSimpleFileCall("grep", args as SimpleFileArgs, theme, ctx as LocalToolRenderContext),
    (result, options, theme, ctx) =>
      renderSimpleFileResult(
        "grep",
        result as ToolResult,
        options,
        theme,
        ctx as LocalToolRenderContext,
      ),
  );
  registerCompactTool(
    pi,
    createFindTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderSimpleFileCall("find", args as SimpleFileArgs, theme, ctx as LocalToolRenderContext),
    (result, options, theme, ctx) =>
      renderSimpleFileResult(
        "find",
        result as ToolResult,
        options,
        theme,
        ctx as LocalToolRenderContext,
      ),
  );
  registerCompactTool(
    pi,
    createLsTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderSimpleFileCall("ls", args as SimpleFileArgs, theme, ctx as LocalToolRenderContext),
    (result, options, theme, ctx) =>
      renderSimpleFileResult(
        "ls",
        result as ToolResult,
        options,
        theme,
        ctx as LocalToolRenderContext,
      ),
  );
  registerCompactTool(
    pi,
    createWriteTool(cwd) as unknown as CompactTool,
    (args, theme, ctx) =>
      renderSimpleFileCall("write", args as SimpleFileArgs, theme, ctx as LocalToolRenderContext),
    (result, options, theme, ctx) =>
      renderSimpleFileResult(
        "write",
        result as ToolResult,
        options,
        theme,
        ctx as LocalToolRenderContext,
      ),
  );
  registerCompactTool(
    pi,
    { ...(createEditTool(cwd) as unknown as CompactTool), renderShell: "default" },
    (args, theme, ctx) =>
      renderEditCall(args as { path?: string }, theme, ctx as LocalToolRenderContext),
    (result, options, theme, ctx) =>
      renderEditResult(result as ToolResult, options, theme, ctx as LocalToolRenderContext),
  );

  toolRenderersInstalled = true;
}

export default function littleRendererExtension(pi: ExtensionAPI): void {
  patchAssistantMessages();
  patchToolExecutionRenderers(pi);
  registerThinkingLabels(pi);
}
