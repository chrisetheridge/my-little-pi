import { SessionManager, type ExtensionAPI, type SessionInfo, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, isKeyRelease, matchesKey, truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
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

class RecentSessionsHeader implements Component {
  constructor(
    private readonly state: RecentSessionsState,
    private readonly theme: Theme,
    private readonly error?: string,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [];

    const lines: string[] = [];
    const title = this.theme.fg("accent", this.theme.bold("Recent Pi sessions"));
    lines.push(truncateToWidth(title, width));

    if (this.error) {
      lines.push(truncateToWidth(this.theme.fg("warning", `Could not load sessions: ${this.error}`), width));
      lines.push("");
      return lines;
    }

    if (this.state.rows.length === 0) {
      lines.push(truncateToWidth(this.theme.fg("dim", "No previous sessions found."), width));
      lines.push("");
      return lines;
    }

    const markerWidth = 2;
    const dateWidth = Math.min(16, Math.max(10, Math.floor(width * 0.18)));
    const repoWidth = Math.min(34, Math.max(14, Math.floor(width * 0.28)));
    const gap = "  ";
    const fixedWidth = markerWidth + dateWidth + repoWidth + visibleWidth(gap) * 2;
    const titleWidth = Math.max(8, width - fixedWidth);

    const heading =
      "  " +
      this.theme.fg("dim", padAnsi("date", dateWidth)) +
      gap +
      this.theme.fg("dim", padAnsi("folder/repo", repoWidth)) +
      gap +
      this.theme.fg("dim", "title");
    lines.push(truncateToWidth(heading, width));

    this.state.rows.forEach((row, index) => {
      const isSelected = index === this.state.selected;
      const marker = isSelected ? this.theme.fg("accent", "› ") : "  ";
      const date = this.theme.fg(isSelected ? "text" : "muted", padAnsi(row.date, dateWidth));
      const repo = this.theme.fg(isSelected ? "accent" : "text", padAnsi(row.repo, repoWidth));
      const sessionTitle = truncateToWidth(row.title || row.cwd, titleWidth, "…");
      const line = marker + date + gap + repo + gap + sessionTitle;
      lines.push(truncateToWidth(isSelected ? this.theme.bg("selectedBg", line) : line, width));
    });

    lines.push(
      truncateToWidth(
        this.theme.fg("dim", "↑↓ choose recent session • enter load • type normally to ignore • /recent opens picker"),
        width,
      ),
    );
    lines.push("");
    return lines;
  }

  invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
  let state: RecentSessionsState = { rows: [], selected: 0 };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    try {
      state = { rows: await loadRows(), selected: 0 };
      ctx.ui.setHeader((tui, theme) => {
        const header = new RecentSessionsHeader(state, theme);
        return {
          render: (width: number) => header.render(width),
          invalidate: () => header.invalidate(),
          dispose: ctx.ui.onTerminalInput((data) => {
            if (state.rows.length === 0) return;
            if (ctx.ui.getEditorText().trim().length > 0) return;
            if (isKeyRelease(data)) return { consume: true };

            if (matchesKey(data, Key.up)) {
              state.selected = clamp(state.selected - 1, 0, state.rows.length - 1);
              tui.requestRender();
              return { consume: true };
            }

            if (matchesKey(data, Key.down)) {
              state.selected = clamp(state.selected + 1, 0, state.rows.length - 1);
              tui.requestRender();
              return { consume: true };
            }

            if (matchesKey(data, Key.enter)) {
              ctx.ui.setEditorText(`/recent ${state.selected}`);
              return { data };
            }
          }),
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setHeader((_tui, theme) => new RecentSessionsHeader({ rows: [], selected: 0 }, theme, message));
    }
  });
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

function padAnsi(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
