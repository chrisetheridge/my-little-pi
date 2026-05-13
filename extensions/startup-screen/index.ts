import {
  SessionManager,
  VERSION,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionInfo,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import {
  Key,
  isKeyRelease,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@mariozechner/pi-tui";
import path from "node:path";

const MAX_SESSIONS = 10;

interface RecentSessionRow {
  path: string;
  date: string;
  repo: string;
  title: string;
  cwd: string;
}

interface RecentSessionsState {
  rows: RecentSessionRow[];
  selected: number;
}

class StartupHeader implements Component {
  readonly #unsubscribe?: () => void;

  constructor(
    private readonly tui: TUI,
    private readonly ctx: ExtensionContext,
    private readonly state: RecentSessionsState,
    private readonly theme: Theme,
    private readonly error?: string,
  ) {
    this.#unsubscribe = ctx.ui.onTerminalInput(data => this.#onTerminalInput(data));
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    const maxWidth = Math.min(width, 104);
    const canUseColumns = maxWidth >= 72;
    const leftWidth = canUseColumns ? 24 : maxWidth;
    const rightWidth = canUseColumns ? maxWidth - leftWidth - 3 : maxWidth;

    const left = this.#renderIdentity(leftWidth);
    const right = this.#renderRecentSessions(rightWidth);
    const lines: string[] = [""];

    if (!canUseColumns) {
      lines.push(...left.map(line => truncateToWidth(line, width)));
      lines.push("");
      lines.push(...right.map(line => truncateToWidth(line, width)));
      lines.push("");
      return lines;
    }

    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i++) {
      const lhs = fitAnsi(left[i] ?? "", leftWidth);
      const sep = this.theme.fg("dim", " │ ");
      const rhs = fitAnsi(right[i] ?? "", rightWidth);
      lines.push(truncateToWidth(lhs + sep + rhs, width));
    }

    lines.push("");
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.#unsubscribe?.();
  }

  #renderIdentity(width: number): string[] {
    const model = this.ctx.model?.name ?? "unknown model";
    const provider = this.ctx.model?.provider ?? "unknown provider";
    const subtitle = `${this.theme.fg("muted", "pi")}${this.theme.fg("dim", ` v${VERSION}`)}`;

    return [
      centerAnsi(this.theme.bold(this.theme.fg("accent", "my little pi")), width),
      "",
      ...getPiMascot(this.theme).map(line => centerAnsi(line, width)),
      "",
      centerAnsi(this.theme.fg("muted", model), width),
      centerAnsi(this.theme.fg("dim", provider), width),
      centerAnsi(subtitle, width),
    ];
  }

  #renderRecentSessions(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.bold(this.theme.fg("accent", "Recent sessions")));

    if (this.error) {
      lines.push(this.theme.fg("warning", `Could not load sessions: ${this.error}`));
      return lines;
    }

    if (this.state.rows.length === 0) {
      lines.push(this.theme.fg("dim", "No previous sessions found."));
      return lines;
    }

    const markerWidth = 2;
    const dateWidth = Math.min(15, Math.max(10, Math.floor(width * 0.2)));
    const repoWidth = Math.min(28, Math.max(12, Math.floor(width * 0.3)));
    const gap = "  ";
    const fixedWidth = markerWidth + dateWidth + repoWidth + visibleWidth(gap) * 2;
    const titleWidth = Math.max(8, width - fixedWidth);

    const heading =
      "  " +
      this.theme.fg("dim", padAnsi("date", dateWidth)) +
      gap +
      this.theme.fg("dim", padAnsi("folder/repo", repoWidth)) +
      gap +
      this.theme.fg("dim", "context");
    lines.push(heading);

    this.state.rows.forEach((row, index) => {
      const isSelected = index === this.state.selected;
      const marker = isSelected ? this.theme.fg("accent", "› ") : "  ";
      const date = this.theme.fg(isSelected ? "text" : "muted", padAnsi(row.date, dateWidth));
      const repo = this.theme.fg(isSelected ? "accent" : "text", padAnsi(row.repo, repoWidth));
      const sessionTitle = truncateToWidth(row.title || row.cwd, titleWidth, "…");
      const line = marker + date + gap + repo + gap + sessionTitle;
      lines.push(isSelected ? this.theme.bg("selectedBg", line) : line);
    });

    lines.push(
      this.theme.fg("dim", "shift + j / k choose • ctrl + enter load • /recent opens picker"),
    );
    return lines;
  }

  #onTerminalInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (this.state.rows.length === 0) return undefined;
    if (this.ctx.ui.getEditorText().trim().length > 0) return undefined;
    if (isKeyRelease(data)) return { consume: true };

    if (matchesKey(data, Key.shift("k"))) {
      this.state.selected = clamp(this.state.selected - 1, 0, this.state.rows.length - 1);
      this.tui.requestRender();
      return { consume: true };
    }

    if (matchesKey(data, Key.shift("j"))) {
      this.state.selected = clamp(this.state.selected + 1, 0, this.state.rows.length - 1);
      this.tui.requestRender();
      return { consume: true };
    }

    if (matchesKey(data, Key.ctrl("enter"))) {
      this.ctx.ui.setEditorText(`/recent ${this.state.selected}`);
      return { data: "\r" };
    }
  }
}

export default function (pi: ExtensionAPI) {
  let state: RecentSessionsState = { rows: [], selected: 0 };

  pi.registerCommand("recent", {
    description: "Resume a recent session from the startup screen",
    handler: async (args, ctx) => {
      await resumeRecentSession(args, ctx, state);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    try {
      state = { rows: await loadRows(), selected: 0 };
      ctx.ui.setHeader((tui, theme) => new StartupHeader(tui, ctx, state, theme));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setHeader((tui, theme) => new StartupHeader(tui, ctx, { rows: [], selected: 0 }, theme, message));
    }
  });
}

async function resumeRecentSession(
  args: string,
  ctx: ExtensionCommandContext,
  state: RecentSessionsState,
): Promise<void> {
  const rows = state.rows.length > 0 ? state.rows : await loadRows();
  if (rows.length === 0) {
    ctx.ui.notify("No previous sessions found.", "warning");
    return;
  }

  const trimmed = args.trim();
  const selected = trimmed.length > 0 ? Number.parseInt(trimmed, 10) : await selectRecentSession(ctx, rows);
  const row = selected !== undefined && Number.isInteger(selected) ? rows[selected] : undefined;

  if (!row) {
    ctx.ui.notify("Recent session not found.", "warning");
    return;
  }

  await ctx.switchSession(row.path);
}

async function selectRecentSession(ctx: ExtensionCommandContext, rows: RecentSessionRow[]): Promise<number | undefined> {
  const options = rows.map((row, index) => `${index}: ${row.date}  ${row.repo}  ${row.title || row.cwd}`);
  const selected = await ctx.ui.select("Recent sessions", options);
  return selected === undefined ? undefined : options.indexOf(selected);
}

function getPiMascot(theme: Theme): string[] {
  const piBlue = (text: string) => theme.fg("accent", text);
  const eye = `${theme.fg("text", "█")}${theme.fg("dim", "▌")}`;
  const bar = piBlue("█".repeat(14));
  const leg = `${piBlue("██")}    ${piBlue("██")}`;

  return [`     ${eye}  ${eye}`, `  ${bar}`, `     ${leg}`, `     ${leg}`, `     ${leg}`];
}

async function loadRows(): Promise<RecentSessionRow[]> {
  const sessions = await SessionManager.listAll();
  return sessions
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, MAX_SESSIONS)
    .map(toRecentSessionRow);
}

function toRecentSessionRow(session: SessionInfo): RecentSessionRow {
  return {
    path: session.path,
    date: formatDate(session.modified),
    repo: formatRepo(session.cwd),
    title: normalizeTitle(session.name ?? session.firstMessage),
    cwd: session.cwd,
  };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRepo(cwd: string): string {
  if (!cwd) return "unknown";
  const base = path.basename(cwd);
  const parent = path.basename(path.dirname(cwd));
  return parent && parent !== path.sep ? `${parent}/${base}` : base;
}

function normalizeTitle(title: string | undefined): string {
  const normalized = (title ?? "").replace(/\s+/g, " ").trim();
  return normalized || "(untitled)";
}

function centerAnsi(value: string, width: number): string {
  const clipped = truncateToWidth(value, width, "…");
  const padding = Math.max(0, width - visibleWidth(clipped));
  const left = Math.floor(padding / 2);
  return " ".repeat(left) + clipped + " ".repeat(padding - left);
}

function fitAnsi(value: string, width: number): string {
  const clipped = truncateToWidth(value, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function padAnsi(value: string, width: number): string {
  return fitAnsi(value, width);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
